import { toast } from "sonner";
import { AIProvider, ApiMessage } from "@/providers/base";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { AiMessage } from "../MessageBubble";
import { ToolCallDisplay } from "../ToolCallCard";
import { ToolCall, getEnabledTools, executeTool } from "../tools";
import {
  DisplayItem, buildPresetPrompt, genId,
  buildApiHistory, isContextOverflowError, estimateTokens, trimItemsToBudget, unwrapMarkdownFence,
} from "../aiChatHelpers";
import type { ChatSidebarState } from "./useChatSidebar";
import type { ChatSessionState } from "./useChatSession";
import { useSessionTitle } from "./useSessionTitle";

/** Sends one message (and its full agentic tool loop) and generates a short
 * session title from the first exchange. Split out from useChatSession
 * because it's a single large, mostly self-contained async flow that reads
 * a lot of session state but doesn't own any of it. */
export function useSendMessage(params: {
  db: ReturnType<typeof useDB>;
  targetLevel: string;
  providers: AIProvider[];
  sidebar: ChatSidebarState;
  session: ChatSessionState;
  input: string;
  attachment: string | null;
  setInput: (v: string) => void;
  setAttachment: (v: string | null) => void;
  setShowAttachment: (v: boolean) => void;
}) {
  const { db, targetLevel, providers, sidebar, session, input, attachment, setInput, setAttachment, setShowAttachment } = params;
  const t = useT();

  const {
    activeId, setActiveId, displayItems, setDisplayItems, setItems, itemsRef,
    activeTitle, setActiveTitle, setIsNewSession,
    selectedPreset, selectedProviderId, systemPrompt, enabledGroups,
    controllerRef, sessionMetaRef, setStreaming,
  } = session;

  const { generateSessionTitle } = useSessionTitle(sidebar, session);

  const sendMessage = async (overrideText?: string) => {
    const typed = (overrideText ?? input).trim();
    const fullText = attachment ? (typed ? `${typed}\n\n${attachment}` : attachment) : typed;
    if (!fullText || session.streaming) return;

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
    // Calendar tools take relative dates ("tomorrow", "next Friday") from the
    // user, but the model has no clock — hand it today's date so it can
    // resolve those itself instead of guessing or asking. Appended only for
    // the outgoing request, never persisted into the saved sysPrompt, so a
    // reopened session doesn't accumulate stale date lines turn after turn.
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const providerPrompt = enabledGroups.has("calendar")
      ? `${sysPrompt}\n\nToday's date is ${todayIso} (YYYY-MM-DD, user's local time zone). Use it to resolve relative dates like "tomorrow" or "next Friday" when calling calendar tools.`
      : sysPrompt;
    // Save the user's turn before starting the network request. This makes a
    // new session visible in History immediately and survives app/API failure.
    await sidebar.saveSession(sessionId, title, [...displayItems, userItem], sysPrompt, selectedPreset, selectedProviderId);
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
            currentApiMsgs, providerPrompt, tools, controller.signal,
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
          for await (const chunk of provider.chat(simpleMsgs, providerPrompt, controller.signal)) {
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
      await sidebar.saveSession(sessionId, title, currentItems, sysPrompt, selectedPreset, selectedProviderId);

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

  return { sendMessage };
}
