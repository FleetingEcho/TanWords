import { useState, useEffect, useRef, useCallback } from "react";
import type { FC } from "react";
import { toast } from "sonner";
import { SparkIcon } from "@/components/ui/icons";
import { PencilSquareIcon, LanguageIcon, EnvelopeIcon } from "@heroicons/react/24/outline";
import { getAllProviders } from "@/providers";
import { AIProvider, ApiMessage } from "@/providers/base";
import { useDB, ChatSessionItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { AiMessage } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallCard";
import { ToolCall, ToolGroupKey, getEnabledTools, executeTool } from "./tools";
import {
  DisplayItem, PRESET_IDS, ATTACH_THRESHOLD,
  buildPresetPrompt, groupSessions, genId, estimateTokens,
  serializeItems, deserializeItems, buildApiHistory,
} from "./aiChatHelpers";

const QUICK_CARDS: { icon: FC<{ className?: string }>; titleKey: string; prefillKey: string }[] = [
  { icon: SparkIcon, titleKey: "aichat.quick.extract", prefillKey: "aichat.quick.extract.prefill" },
  { icon: PencilSquareIcon, titleKey: "aichat.quick.polish", prefillKey: "aichat.quick.polish.prefill" },
  { icon: LanguageIcon, titleKey: "aichat.quick.compare", prefillKey: "aichat.quick.compare.prefill" },
  { icon: EnvelopeIcon, titleKey: "aichat.quick.email", prefillKey: "aichat.quick.email.prefill" },
];

/** All state and business logic behind AiChatPage — split out so the page
 *  component itself only has to worry about rendering. */
export function useAiChatSession() {
  const db = useDB();
  const t = useT();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const providers = getAllProviders().filter((p) => p.apiKey);

  // Sidebar
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSessionItem[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active session
  const [activeId, setActiveId] = useState<string | null>(null);
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [activeTitle, setActiveTitle] = useState("");
  const [isNewSession, setIsNewSession] = useState(true);

  // Settings
  const [selectedPreset, setSelectedPreset] = useState("english-tutor");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState(() => providers[0]?.id ?? "");
  const [enabledGroups, setEnabledGroups] = useState<Set<ToolGroupKey>>(
    () => new Set<ToolGroupKey>(["vocabulary", "documents"])
  );
  const [showTools, setShowTools] = useState(false);

  // UI
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [showAttachment, setShowAttachment] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Mirrors displayItems so an aborted stream can still save what arrived
  const itemsRef = useRef<DisplayItem[]>([]);
  const sessionMetaRef = useRef({ id: "", title: "" });
  // Mirrors activeId so the fire-and-forget title generation can tell if the
  // user has since switched away from the session it's naming.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const systemPrompt = selectedPreset === "custom" ? customPrompt : buildPresetPrompt(selectedPreset, targetLevel);

  const setItems = useCallback((items: DisplayItem[]) => {
    itemsRef.current = items;
    setDisplayItems(items);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    const items = await db.listChatSessions(0, 200);
    setSessions(items);
    return items;
  }, [db]);

  useEffect(() => {
    loadSessions().then((items) => {
      if (items.length > 0) switchSession(items[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) setSelectedProviderId(providers[0].id);
  }, [providers.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayItems.length]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // ── Search ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchResults(await db.searchChatSessions(searchQuery.trim()));
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, db]);

  // ── Session management ─────────────────────────────────────────────────

  const switchSession = useCallback(async (id: string) => {
    controllerRef.current?.abort();
    setStreaming(false);
    setActiveId(id);
    setIsNewSession(false);
    setInput("");
    setAttachment(null);
    const detail = await db.getChatSession(id);
    if (!detail) return;
    setItems(deserializeItems(detail.messages));
    setActiveTitle(detail.title);
    setSelectedPreset(detail.preset_id);
    if (detail.preset_id === "custom") setCustomPrompt(detail.system_prompt || "");
    setSelectedProviderId(detail.provider_id || providers[0]?.id || "");
  }, [db, providers, setItems]);

  const startNew = () => {
    controllerRef.current?.abort();
    setStreaming(false);
    setActiveId(genId());
    setItems([]);
    setActiveTitle("");
    setIsNewSession(true);
    setInput("");
    setAttachment(null);
    setSearchQuery("");
    setSearchResults(null);
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.deleteChatSession(id);
    setSessions((p) => p.filter((s) => s.id !== id));
    setSearchResults((p) => p?.filter((s) => s.id !== id) ?? null);
    if (activeId === id) {
      const rest = sessions.filter((s) => s.id !== id);
      if (rest.length > 0) switchSession(rest[0].id);
      else startNew();
    }
  };

  const clearMessages = async () => {
    controllerRef.current?.abort();
    setStreaming(false);
    setItems([]);
    if (activeId && !isNewSession) {
      await db.upsertChatSession({ id: activeId, title: activeTitle, messages: "[]", systemPrompt, presetId: selectedPreset, providerId: selectedProviderId, messageCount: 0 });
      await loadSessions();
    }
  };

  const saveSession = useCallback(async (
    id: string, title: string, items: DisplayItem[], sysPrompt: string, presetId: string, providerId: string
  ) => {
    const msgCount = items.filter((i) => i.kind === "message").length;
    await db.upsertChatSession({
      id, title,
      messages: serializeItems(items),
      systemPrompt: sysPrompt,
      presetId,
      providerId,
      messageCount: msgCount,
    });
    await loadSessions();
  }, [db, loadSessions]);

  const toggleGroup = (g: ToolGroupKey) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  // ── Paste-to-attachment ────────────────────────────────────────────────

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (text.length > ATTACH_THRESHOLD) {
      e.preventDefault();
      setAttachment((prev) => (prev ? `${prev}\n\n${text}` : text));
    }
  };

  // ── Stop generation ────────────────────────────────────────────────────

  const handleStop = () => {
    controllerRef.current?.abort();
    setStreaming(false);
    const { id, title } = sessionMetaRef.current;
    if (id) {
      saveSession(id, title, itemsRef.current, systemPrompt, selectedPreset, selectedProviderId);
    }
  };

  /** Best-effort short title from the first exchange; never blocks or throws into the caller. */
  const generateSessionTitle = async (
    sessionId: string,
    userText: string,
    assistantText: string,
    provider: AIProvider
  ) => {
    try {
      const sys = "Summarize the following exchange as a short chat title. Output ONLY the title — no quotes, no punctuation at the end, no explanation. Max 10 Chinese characters, or 6 English words, whichever fits the conversation's language.";
      const user = `User: ${userText.slice(0, 500)}\nAssistant: ${assistantText.slice(0, 500)}`;
      let raw = "";
      for await (const chunk of provider.generate(sys, user)) raw += chunk;
      const cleaned = raw.trim().replace(/^["'「『]|["'」』.。!！?？]+$/g, "").slice(0, 24);
      if (!cleaned || activeIdRef.current !== sessionId) return;

      setActiveTitle((prev) => (activeIdRef.current === sessionId ? cleaned : prev));
      await saveSession(sessionId, cleaned, itemsRef.current, systemPrompt, selectedPreset, selectedProviderId);
    } catch {
      // Keep the truncated fallback title already saved.
    }
  };

  // ── Send with agentic tool loop ────────────────────────────────────────

  const sendMessage = async (overrideText?: string) => {
    const typed = (overrideText ?? input).trim();
    const fullText = attachment ? (typed ? `${typed}\n\n${attachment}` : attachment) : typed;
    if (!fullText || streaming) return;

    const provider = providers.find((p) => p.id === selectedProviderId) ?? providers[0];
    if (!provider) { toast.error(t("aichat.noProvider")); return; }

    const sessionId = activeId ?? genId();
    if (!activeId) setActiveId(sessionId);

    const userItem: DisplayItem = { kind: "message", msg: { role: "user", content: fullText } };
    const assistantItem: DisplayItem = { kind: "message", msg: { role: "assistant", content: "" } };

    const isFirst = displayItems.filter((i) => i.kind === "message").length === 0;
    const titleSource = typed || fullText;
    const title = isFirst ? titleSource.slice(0, 50) + (titleSource.length > 50 ? "…" : "") : activeTitle;
    if (isFirst) setActiveTitle(title);
    sessionMetaRef.current = { id: sessionId, title };

    let currentItems: DisplayItem[] = [...displayItems, userItem, assistantItem];
    setItems(currentItems);
    setInput("");
    setAttachment(null);
    setShowAttachment(false);
    setStreaming(true);
    setIsNewSession(false);

    // Rebuild the API message history from display items, preserving any
    // prior tool_use/tool_result turns so the model keeps that context.
    const historyMsgs = buildApiHistory(displayItems);
    let currentApiMsgs: ApiMessage[] = [...historyMsgs, { role: "user", content: fullText }];

    const tools = getEnabledTools(enabledGroups);
    const sysPrompt = systemPrompt || buildPresetPrompt("english-tutor", targetLevel);
    const controller = new AbortController();
    controllerRef.current = controller;

    const updateLastAssistant = (content: string) => {
      setDisplayItems((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const item = next[i];
          if (item.kind === "message" && item.msg.role === "assistant") {
            next[i] = { kind: "message", msg: { role: "assistant", content } };
            itemsRef.current = next;
            return next;
          }
        }
        itemsRef.current = next;
        return next;
      });
    };

    try {
      const MAX_ITER = 5;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        let textContent = "";

        if (tools.length > 0 && provider.chatWithTools) {
          // ── Tool-enabled path ──────────────────────────────────────────
          const response = await provider.chatWithTools(
            currentApiMsgs, sysPrompt, tools, controller.signal,
            (chunk) => { textContent += chunk; updateLastAssistant(textContent); }
          );
          textContent = response.textContent;
          updateLastAssistant(textContent);

          currentItems = currentItems.map((item, idx) => {
            if (item.kind === "message" && item.msg.role === "assistant" && idx === currentItems.length - 1) {
              return { kind: "message", msg: { role: "assistant", content: textContent } };
            }
            return item;
          });

          if (response.toolCalls.length === 0 || response.stopReason !== "tool_use") break;

          // ── Show pending tool block ────────────────────────────────────
          const pendingCalls: ToolCallDisplay[] = response.toolCalls.map((tc) => ({
            id: tc.id, name: tc.name, input: tc.input as Record<string, unknown>, status: "pending",
          }));
          const toolBlockIdx = currentItems.length;
          currentItems = [...currentItems, { kind: "tool_block", calls: pendingCalls }];
          setItems(currentItems);

          // ── Execute tools ──────────────────────────────────────────────
          const results = await Promise.all(response.toolCalls.map((tc) => executeTool(tc as ToolCall)));

          const doneCalls: ToolCallDisplay[] = pendingCalls.map((pc, i) => ({
            ...pc,
            result: results[i].content,
            is_error: results[i].is_error,
            status: results[i].is_error ? "error" : "done",
          }));
          currentItems = currentItems.map((item, idx) =>
            idx === toolBlockIdx ? { kind: "tool_block", calls: doneCalls } : item
          );
          setItems(currentItems);

          // ── Add new empty assistant bubble for next iteration ──────────
          const nextAssistant: DisplayItem = { kind: "message", msg: { role: "assistant", content: "" } };
          currentItems = [...currentItems, nextAssistant];
          setItems(currentItems);

          // ── Update API conversation history ────────────────────────────
          currentApiMsgs = [
            ...currentApiMsgs,
            {
              role: "assistant" as const,
              content: [
                ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
                ...response.toolCalls.map((tc) => ({
                  type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.input,
                })),
              ],
            },
            {
              role: "user" as const,
              content: results.map((r) => ({
                type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content, is_error: r.is_error,
              })),
            },
          ];

        } else {
          // ── No-tools path (plain streaming) ───────────────────────────
          const simpleMsgs = currentApiMsgs.map((m) =>
            typeof m.content === "string"
              ? { role: m.role, content: m.content }
              : { role: m.role, content: (m.content as any[]).filter((b) => b.type === "text").map((b: any) => b.text).join("") }
          );
          for await (const chunk of provider.chat(simpleMsgs, sysPrompt, controller.signal)) {
            if (controller.signal.aborted) break;
            textContent += chunk;
            updateLastAssistant(textContent);
          }
          currentItems = currentItems.map((item, idx) =>
            item.kind === "message" && item.msg.role === "assistant" && idx === currentItems.length - 1
              ? { kind: "message", msg: { role: "assistant", content: textContent } }
              : item
          );
          break; // no tool loop for plain chat
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return; // handleStop already saved partial content
      const msg = e?.message ?? "Request failed";
      toast.error(msg.includes("401") ? t("aichat.invalidKey") : t("aichat.requestFailed"));
      updateLastAssistant(`❌ ${msg}`);
    }

    if (!controller.signal.aborted) {
      setStreaming(false);
      setItems(currentItems);
      await saveSession(sessionId, title, currentItems, sysPrompt, selectedPreset, selectedProviderId);

      // Replace the truncated first-message title with a short AI-generated
      // one once the exchange has content to summarize. Fire-and-forget —
      // the truncated title already saved above is a perfectly good
      // fallback if this fails or the provider doesn't support it.
      if (isFirst) {
        const lastAssistant = [...currentItems].reverse().find(
          (i): i is { kind: "message"; msg: AiMessage } => i.kind === "message" && i.msg.role === "assistant"
        );
        if (lastAssistant?.msg.content) {
          generateSessionTitle(sessionId, fullText, lastAssistant.msg.content, provider);
        }
      }
    }
  };

  const applyQuickCard = (prefillKey: string) => {
    setInput(t(prefillKey));
    textareaRef.current?.focus();
  };

  const displaySessions = searchResults ?? sessions;

  return {
    // sidebar
    displaySessions, grouped: groupSessions(displaySessions), searchQuery, setSearchQuery,
    activeId, switchSession, deleteSession, startNew,
    // active session
    displayItems, activeTitle, isNewSession, streaming,
    tokenCount: estimateTokens(displayItems),
    // settings
    selectedPreset, setSelectedPreset, customPrompt, setCustomPrompt,
    selectedProviderId, setSelectedProviderId, providers,
    enabledGroups, toggleGroup, showTools, setShowTools,
    clearMessages,
    // composer
    input, setInput, attachment, setAttachment, showAttachment, setShowAttachment,
    handlePaste, handleStop, sendMessage,
    QUICK_CARDS, applyQuickCard,
    bottomRef, textareaRef,
  };
}

export { PRESET_IDS };
