import { useState, useEffect, useCallback } from "react";
import { useProviderStatus } from "@/hooks/useProviderStatus";
import { useDB } from "@/hooks/useDB";
import { useSettingsStore } from "@/store/settingsStore";
import { estimateTokens, buildArticleBody, PRESET_IDS } from "./aiChatHelpers";
import { useChatSidebar } from "./hooks/useChatSidebar";
import { useChatSession } from "./hooks/useChatSession";
import { useChatComposer } from "./hooks/useChatComposer";
import { useSendMessage } from "./hooks/useSendMessage";

const SUMMARIZE_AND_SAVE_PROMPT =
  "Summarize this conversation as a concise Markdown note, then save it to Documents. " +
  "Call summarize_conversation to prepare the note, then save_note_as_document to persist it. " +
  "Use a short descriptive title and structure the body as: key points, conclusions, and anything worth keeping.";

/** All state and business logic behind AiChatPage — split out so the page
 *  component itself only has to worry about rendering. Composes:
 *  - useChatSidebar: the session list, search, and saveSession
 *  - useChatSession: the open session's messages/settings and switch/new/delete
 *  - useChatComposer: input, attachment, and scroll behavior
 *  - useSendMessage: the actual send + agentic tool loop
 */
export function useAiChatSession(initialSessionId?: string) {
  const db = useDB();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  // Subscribed, not sampled: on a cold start the registry is still empty while
  // initProviders() reads the keychain, and this list has to fill in when it lands.
  const { available: providers } = useProviderStatus();

  const sidebar = useChatSidebar(db);
  const session = useChatSession({ db, targetLevel, providers, initialSessionId, sidebar });
  const composer = useChatComposer(session.displayItems, session.streaming);

  const switchSession = useCallback(async (id: string) => {
    composer.resetForSessionChange();
    await session.switchSession(id);
  }, [composer, session]);

  const startNew = useCallback(() => {
    composer.resetForSessionChange();
    session.startNew();
  }, [composer, session]);

  const { sendMessage } = useSendMessage({
    db, targetLevel, providers, sidebar, session,
    input: composer.input, attachment: composer.attachment,
    setInput: composer.setInput, setAttachment: composer.setAttachment, setShowAttachment: composer.setShowAttachment,
  });

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
    session.setSelectedPreset("reading-tutor");
    setPendingSend(buildArticleBody(article));
  };

  /** One-click "summarize + save": makes sure Documents access is on, then
   *  asks the agent to run the existing two-step tool flow. */
  const summarizeAndSave = () => {
    if (session.streaming) return;
    if (!session.enabledGroups.has("documents")) session.toggleGroup("documents");
    setPendingSend(SUMMARIZE_AND_SAVE_PROMPT);
  };

  useEffect(() => {
    if (pendingSend === null) return;
    setPendingSend(null);
    sendMessage(pendingSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend]);

  // The two callbacks below read the transcript from itemsRef rather than the
  // render's displayItems, so they don't have to list it as a dependency —
  // that would change their identity on every streaming commit and re-render
  // every bubble in the conversation (see MessageBubble's memo).

  /** Re-runs the last user turn: drops the answer (and any tool cards it
   *  produced) and asks again with the same message. */
  const regenerate = useCallback(() => {
    if (session.streaming) return;
    const items = session.itemsRef.current;
    let idx = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "message" && item.msg.role === "user") { idx = i; break; }
    }
    const item = idx >= 0 ? items[idx] : null;
    if (!item || item.kind !== "message") return;
    session.truncateTo(idx);
    setPendingSend(item.msg.content);
  }, [session]);

  /** Moves a user message back into the composer and drops everything from
   *  it onward, so it can be reworded and re-sent instead of retyped. */
  const editUserMessage = useCallback((index: number) => {
    if (session.streaming) return;
    const item = session.itemsRef.current[index];
    if (item?.kind !== "message" || item.msg.role !== "user") return;
    session.truncateTo(index);
    composer.setInput(item.msg.content);
    window.setTimeout(() => composer.textareaRef.current?.focus(), 0);
  }, [session, composer]);

  return {
    // sidebar
    displaySessions: sidebar.displaySessions, archivedSessions: sidebar.archivedSessions,
    searchQuery: sidebar.searchQuery, setSearchQuery: sidebar.setSearchQuery,
    dateFrom: sidebar.dateFrom, dateTo: sidebar.dateTo, setDateRange: sidebar.setDateRange,
    activeId: session.activeId, switchSession, deleteSession: session.deleteSession,
    toggleArchived: sidebar.toggleArchived, togglePinned: sidebar.togglePinned,
    renameSession: session.renameSession, startNew, startWithArticle, summarizeAndSave,
    // active session
    displayItems: session.displayItems, activeTitle: session.activeTitle,
    isNewSession: session.isNewSession, streaming: session.streaming,
    tokenCount: estimateTokens(session.displayItems),
    // settings
    selectedPreset: session.selectedPreset, setSelectedPreset: session.setSelectedPreset,
    customPrompt: session.customPrompt, setCustomPrompt: session.setCustomPrompt,
    selectedProviderId: session.selectedProviderId, setSelectedProviderId: session.setSelectedProviderId, providers,
    enabledGroups: session.enabledGroups, toggleGroup: session.toggleGroup,
    showTools: session.showTools, setShowTools: session.setShowTools,
    clearMessages: session.clearMessages,
    privateMode: session.privateMode, togglePrivateMode: session.togglePrivateMode,
    // composer
    input: composer.input, setInput: composer.setInput,
    attachment: composer.attachment, setAttachment: composer.setAttachment,
    showAttachment: composer.showAttachment, setShowAttachment: composer.setShowAttachment,
    handlePaste: composer.handlePaste, handleStop: session.handleStop, sendMessage,
    regenerate, editUserMessage, canRegenerate: !session.streaming && session.lastUserIndex() >= 0,
    bottomRef: composer.bottomRef, scrollHostRef: composer.scrollHostRef, textareaRef: composer.textareaRef,
    showScrollToBottom: composer.showScrollToBottom, scrollToBottom: composer.scrollToBottom,
  };
}

export { PRESET_IDS };
