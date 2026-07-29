import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { AIProvider, ApiMessage } from "@/providers/base";
import { useProviderStatus } from "@/hooks/useProviderStatus";
import { useDB, ChatSessionItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { useLearnChatStore } from "@/store/learnChatStore";
import { AiMessage } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallCard";
import { ToolCall, ToolGroupKey, getEnabledTools, executeTool } from "./tools";
import {
  DisplayItem, PRESET_IDS, ATTACH_THRESHOLD,
  buildPresetPrompt, genId, estimateTokens,
  serializeItems, deserializeItems, buildApiHistory, isContextOverflowError,
  buildArticleBody, trimItemsToBudget, unwrapMarkdownFence,
} from "./aiChatHelpers";


/** All state and business logic behind AiChatPage — split out so the page
 *  component itself only has to worry about rendering. */
export function useAiChatSession(initialSessionId?: string) {
  const db = useDB();
  const t = useT();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  // Subscribed, not sampled: on a cold start the registry is still empty while
  // initProviders() reads the keychain, and this list has to fill in when it lands.
  const { available: providers } = useProviderStatus();

  // Sidebar
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ChatSessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // Last-activity range filter, YYYY-MM-DD. Empty = no bound.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSessionItem[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active session
  const [activeId, setActiveId] = useState<string | null>(null);
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [activeTitle, setActiveTitle] = useState("");
  const [isNewSession, setIsNewSession] = useState(true);

  // Settings
  const [selectedPreset, setSelectedPreset] = useState("english-tutor");
  const [customPrompt, setCustomPrompt] = useState(() => buildPresetPrompt("english-tutor", targetLevel));
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  // False once the user scrolls away from the bottom, so a long answer that
  // keeps streaming can't yank them back to it while they're reading earlier
  // parts of the conversation.
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Mirrors displayItems so an aborted stream can still save what arrived
  const itemsRef = useRef<DisplayItem[]>([]);
  const sessionMetaRef = useRef({ id: "", title: "" });
  // Mirrors activeId so the fire-and-forget title generation can tell if the
  // user has since switched away from the session it's naming.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  // Set by startNew()/switchSession() so the mount-time auto-restore below —
  // whose loadSessions() call is async and can resolve after either of those
  // — knows to bail instead of clobbering whatever the user/caller already
  // did with an older, no-longer-relevant session's messages.
  const skipAutoRestoreRef = useRef(false);
  // Bumped by every switchSession()/startNew() call. switchSession's DB fetch
  // is async — if startNew() (or a newer switchSession) runs while one is still
  // in flight, its continuation must not apply the stale session it fetched.
  const sessionEpochRef = useRef(0);

  // Keep the effective prompt explicit and editable for every role. Presets are
  // starting points, not opaque behavior that users cannot inspect or change.
  const systemPrompt = customPrompt || buildPresetPrompt(selectedPreset, targetLevel);

  const setItems = useCallback((items: DisplayItem[]) => {
    itemsRef.current = items;
    setDisplayItems(items);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    const [active, archived] = await Promise.all([
      db.listChatSessions(0, 200, { archived: false, dateFrom, dateTo }),
      db.listChatSessions(0, 200, { archived: true, dateFrom, dateTo }),
    ]);
    setSessions(active);
    setArchivedSessions(archived);
    return active;
  }, [db, dateFrom, dateTo]);

  // Re-query when the range changes. The mount-time load below runs this too,
  // so this only fires on an actual filter change.
  useEffect(() => { void loadSessions(); }, [dateFrom, dateTo]);

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

  // Opening the page lands on an empty new conversation. Only an explicit
  // request opens history: a caller naming a session (the reader's "Open in
  // AI Chat"), or the user clicking one in the sidebar. Auto-restoring the
  // last-active chat means every visit starts mid-conversation in something
  // the user didn't ask for.
  useEffect(() => {
    loadSessions().then((items) => {
      if (skipAutoRestoreRef.current) return; // startNew/switchSession already won this mount
      const target = initialSessionId && items.find((item) => item.id === initialSessionId);
      if (target) switchSession(target.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  // Background Reading Tutor jobs persist their partial transcript while they
  // stream. If one is open in this page/modal, reflect those writes live
  // without taking ownership of (or interrupting) the background request.
  useEffect(() => {
    const onExternalSessionUpdate = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!sessionId) return;
      const openingInitialSession = !activeIdRef.current && initialSessionId === sessionId;
      if (!openingInitialSession && sessionId !== activeIdRef.current) return;
      void db.getChatSession(sessionId).then((detail) => {
        if (!detail) return;
        if (openingInitialSession) {
          skipAutoRestoreRef.current = true;
          setActiveId(sessionId);
          setIsNewSession(false);
          setSelectedPreset(detail.preset_id);
          setCustomPrompt(detail.system_prompt || buildPresetPrompt(detail.preset_id, targetLevel));
          setSelectedProviderId(detail.provider_id || providers[0]?.id || "");
        } else if (activeIdRef.current !== sessionId) {
          return;
        }
        setItems(deserializeItems(detail.messages));
        setActiveTitle(detail.title);
      });
    };
    window.addEventListener("tanwords:chat-session-updated", onExternalSessionUpdate);
    return () => window.removeEventListener("tanwords:chat-session-updated", onExternalSessionUpdate);
  }, [db, initialSessionId, providers, setItems, targetLevel]);

  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) setSelectedProviderId(providers[0].id);
  }, [providers.length]);

  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    const onScroll = () => {
      const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      stickToBottomRef.current = atBottom;
      setShowScrollToBottom(!atBottom);
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  // Follows the answer as it streams, not just when a new bubble appears: a
  // streaming turn grows the *content* of the last item without changing the
  // item count, so keying this on length alone left the user scrolling by
  // hand for the whole response. Jumps instantly while streaming — a smooth
  // animation every 50ms commit never finishes and looks like drift.
  const tail = displayItems[displayItems.length - 1];
  const tailLength = tail?.kind === "message" ? tail.msg.content.length : 0;
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [displayItems.length, tailLength, streaming]);

  const scrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // Cap matches the composer's max-h; min-h keeps it from shrinking below
    // the resting size, so short messages don't collapse the box.
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
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
    const epoch = ++sessionEpochRef.current;
    skipAutoRestoreRef.current = true;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    controllerRef.current?.abort();
    setStreaming(false);
    setActiveId(id);
    setIsNewSession(false);
    setInput("");
    setAttachment(null);
    const detail = await db.getChatSession(id);
    if (!detail) return;
    // A newer switchSession/startNew ran while this fetch was in flight —
    // applying this stale result now would clobber whatever it set up.
    if (sessionEpochRef.current !== epoch) return;
    setItems(deserializeItems(detail.messages));
    setActiveTitle(detail.title);
    setSelectedPreset(detail.preset_id);
    setCustomPrompt(detail.system_prompt || buildPresetPrompt(detail.preset_id, targetLevel));
    setSelectedProviderId(detail.provider_id || providers[0]?.id || "");
  }, [db, providers, setItems, targetLevel]);

  const startNew = () => {
    sessionEpochRef.current++;
    skipAutoRestoreRef.current = true;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
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

  // Deferred to a render tick (see the effect below) rather than sent inline —
  // sendMessage reads selectedPreset/systemPrompt/activeId/displayItems from
  // this closure, which is still the *previous* render's until React actually
  // commits the setState calls its caller just made (a new preset in
  // startWithArticle, a truncated history in regenerate).
  const [pendingSend, setPendingSend] = useState<string | null>(null);

  /** Opens a fresh conversation with the Reading Tutor preset and the given
   *  article as the first message — the "Learn" action's new home now that
   *  there's no standalone Reading page to hand articles off to. */
  const startWithArticle = (article: { title: string; text: string; commentsText?: string }) => {
    startNew();
    selectPreset("reading-tutor");
    setPendingSend(buildArticleBody(article));
  };

  useEffect(() => {
    if (pendingSend === null) return;
    setPendingSend(null);
    sendMessage(pendingSend);
  }, [pendingSend]);

  /** Index of the last user message, or -1. */
  const lastUserIndex = () => {
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const item = displayItems[i];
      if (item.kind === "message" && item.msg.role === "user") return i;
    }
    return -1;
  };

  // The two callbacks below read the transcript from itemsRef rather than the
  // render's displayItems, so they don't have to list it as a dependency —
  // that would change their identity on every streaming commit and re-render
  // every bubble in the conversation (see MessageBubble's memo).

  /** Cuts the conversation back to `index` (exclusive) and persists it, so a
   *  regenerate/edit doesn't leave the discarded turns to reappear the next
   *  time the session is opened. */
  const truncateTo = useCallback((index: number) => {
    const kept = itemsRef.current.slice(0, index);
    setItems(kept);
    if (activeId && !isNewSession) {
      void saveSession(activeId, activeTitle, kept, systemPrompt, selectedPreset, selectedProviderId);
    }
    return kept;
  }, [activeId, isNewSession, activeTitle, systemPrompt, selectedPreset, selectedProviderId, saveSession, setItems]);

  /** Re-runs the last user turn: drops the answer (and any tool cards it
   *  produced) and asks again with the same message. */
  const regenerate = useCallback(() => {
    if (streaming) return;
    const items = itemsRef.current;
    let idx = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "message" && item.msg.role === "user") { idx = i; break; }
    }
    const item = idx >= 0 ? items[idx] : null;
    if (!item || item.kind !== "message") return;
    truncateTo(idx);
    setPendingSend(item.msg.content);
  }, [streaming, truncateTo]);

  /** Moves a user message back into the composer and drops everything from
   *  it onward, so it can be reworded and re-sent instead of retyped. */
  const editUserMessage = useCallback((index: number) => {
    if (streaming) return;
    const item = itemsRef.current[index];
    if (item?.kind !== "message" || item.msg.role !== "user") return;
    truncateTo(index);
    setInput(item.msg.content);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [streaming, truncateTo]);

  const selectPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    setCustomPrompt(presetId === "custom" ? "" : buildPresetPrompt(presetId, targetLevel));
  };

  /** Moves a conversation to (or out of) the archive: it stays searchable and
   *  openable, just folded away from the working list. */
  const toggleArchived = async (id: string, archived: boolean) => {
    await db.setChatSessionArchived(id, archived);
    await loadSessions();
  };

  const togglePinned = async (id: string, pinned: boolean) => {
    await db.setChatSessionPinned(id, pinned);
    await loadSessions();
  };

  const renameSession = async (id: string, title: string) => {
    const ok = await db.renameChatSession(id, title);
    if (!ok) return;
    if (activeId === id) setActiveTitle(title.trim());
    await loadSessions();
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.deleteChatSession(id);
    // A "Learn"/"Analyze in background" job may still be pointing at this session
    // (its checkmark on the reader/RSS card) — clear it so that button reverts to
    // idle instead of opening a chat that no longer exists.
    useLearnChatStore.getState().dismissBySessionId(id);
    setSessions((p) => p.filter((s) => s.id !== id));
    setArchivedSessions((p) => p.filter((s) => s.id !== id));
    setSearchResults((p) => p?.filter((s) => s.id !== id) ?? null);
    // Deleting the open chat drops back to an empty new one rather than
    // pulling up the next history entry, which the user didn't pick either.
    if (activeId === id) startNew();
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


  // Persist partial streaming output as well as completed turns. A long AI
  // response can take minutes; closing the window must not discard it.
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => {
      const { id, title } = sessionMetaRef.current;
      if (!id) return;
      const items = itemsRef.current;
      db.upsertChatSession({
        id, title, messages: serializeItems(items), systemPrompt,
        presetId: selectedPreset, providerId: selectedProviderId,
        messageCount: items.filter((item) => item.kind === "message").length,
      });
      }, 6000);
    return () => window.clearInterval(timer);
  }, [streaming, db, systemPrompt, selectedPreset, selectedProviderId]);

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

    let currentApiMsgs: ApiMessage[] = [];

    // Reading Tutor deliberately uses plain Markdown. This keeps it fast and
    // reliable on local models; words and sentences can already be selected
    // and saved from the rendered answer.
    const tools = selectedPreset === "reading-tutor" ? [] : getEnabledTools(enabledGroups);
    const sysPrompt = systemPrompt || buildPresetPrompt("english-tutor", targetLevel);
    // Save the user's turn before starting the network request. This makes a
    // new session visible in History immediately and survives app/API failure.
    await saveSession(sessionId, title, [...displayItems, userItem], sysPrompt, selectedPreset, selectedProviderId);
    const controller = new AbortController();
    controllerRef.current = controller;

    // Providers may yield token-sized chunks. Rendering Markdown for every
    // token makes long chats progressively more expensive, so coalesce UI
    // updates to roughly one frame every 50ms while retaining every byte.
    let pendingAssistant = "";
    let renderTimer: number | null = null;
    const commitLastAssistant = () => {
      renderTimer = null;
      const content = pendingAssistant;
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
    const updateLastAssistant = (content: string) => {
      pendingAssistant = content;
      if (renderTimer === null) renderTimer = window.setTimeout(commitLastAssistant, 50);
    };
    const flushLastAssistant = () => {
      if (renderTimer !== null) window.clearTimeout(renderTimer);
      commitLastAssistant();
    };

    /** One full assistant turn (streaming + up to MAX_ITER tool rounds),
     *  starting from the given history. Factored out so a context-overflow
     *  failure can replay the same turn against a trimmed history instead of
     *  dead-ending the session. */
    const runTurn = async (history: ApiMessage[]) => {
      currentItems = [...displayItems, userItem, assistantItem];
      setItems(currentItems);
      pendingAssistant = "";
      currentApiMsgs = [...history, { role: "user", content: fullText }];

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
          pendingAssistant = textContent;
          flushLastAssistant();

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
          pendingAssistant = textContent;
          flushLastAssistant();
          currentItems = currentItems.map((item, idx) =>
            item.kind === "message" && item.msg.role === "assistant" && idx === currentItems.length - 1
              ? { kind: "message", msg: { role: "assistant", content: textContent } }
              : item
          );
          break; // no tool loop for plain chat
        }
      }
    };

    try {
      try {
        await runTurn(buildApiHistory(displayItems));
      } catch (e: any) {
        // The model's context window can't hold the whole conversation any
        // more. Rather than dead-ending the session — which used to mean
        // "start a new chat and lose the thread" — drop the oldest turns and
        // replay this one exactly once against the shorter history.
        const historyChars = estimateTokens(displayItems) * 4;
        if (!isContextOverflowError(e) || controller.signal.aborted || historyChars === 0) throw e;
        const { items: kept, droppedTurns } = trimItemsToBudget(displayItems, Math.floor(historyChars / 2));
        if (droppedTurns === 0) throw e;
        toast.info(t("aichat.contextTrimmed", { n: droppedTurns }));
        await runTurn(buildApiHistory(kept));
      }
    } catch (e: any) {
      if (renderTimer !== null) window.clearTimeout(renderTimer);
      if (e?.name === "AbortError") return; // handleStop already saved partial content
      const msg = e?.message ?? "Request failed";
      const friendlyMsg = isContextOverflowError(e)
        ? t("aichat.contextOverflow")
        : msg.includes("401") ? t("aichat.invalidKey") : t("aichat.requestFailed");
      toast.error(friendlyMsg);
      // Write the failure into the bubble itself, not just a toast: the
      // save below persists `currentItems`, so anything left only in the
      // render-coalescing buffer would be overwritten and the turn would
      // reopen later as a blank assistant message.
      currentItems = currentItems.map((item, idx) =>
        idx === currentItems.length - 1 && item.kind === "message" && item.msg.role === "assistant"
          ? { kind: "message" as const, msg: { role: "assistant" as const, content: `❌ ${friendlyMsg}` } }
          : item
      );
      setItems(currentItems);
    }

    if (!controller.signal.aborted) {
      if (renderTimer !== null) window.clearTimeout(renderTimer);
      if (selectedPreset === "reading-tutor") {
        currentItems = currentItems.map((item) =>
          item.kind === "message" && item.msg.role === "assistant"
            ? { ...item, msg: { ...item.msg, content: unwrapMarkdownFence(item.msg.content) } }
            : item
        );
      }
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

  const displaySessions = searchResults ?? sessions;

  return {
    // sidebar
    displaySessions, archivedSessions, searchQuery, setSearchQuery,
    dateFrom, dateTo, setDateRange: (from: string, to: string) => { setDateFrom(from); setDateTo(to); },
    activeId, switchSession, deleteSession, toggleArchived, togglePinned, renameSession, startNew, startWithArticle,
    // active session
    displayItems, activeTitle, isNewSession, streaming,
    tokenCount: estimateTokens(displayItems),
    // settings
    selectedPreset, setSelectedPreset: selectPreset, customPrompt, setCustomPrompt,
    selectedProviderId, setSelectedProviderId, providers,
    enabledGroups, toggleGroup, showTools, setShowTools,
    clearMessages,
    // composer
    input, setInput, attachment, setAttachment, showAttachment, setShowAttachment,
    handlePaste, handleStop, sendMessage,
    regenerate, editUserMessage, canRegenerate: !streaming && lastUserIndex() >= 0,
    bottomRef, scrollHostRef, textareaRef, showScrollToBottom, scrollToBottom,
  };
}

export { PRESET_IDS };
