import React from "react";
import { useT } from "@/hooks/useT";
import { MessageBubble } from "./MessageBubble";
import { ToolCallCard } from "./ToolCallCard";
import { VocabExtractionCard, VOCAB_CARD_TOOL_NAMES, vocabItemsFromToolInput } from "./VocabExtractionCard";
import { SentenceExtractionCard, SENTENCE_CARD_TOOL_NAMES, sentenceItemsFromToolInput } from "./SentenceExtractionCard";
import { NoteCard, NOTE_CARD_TOOL_NAMES, noteFromToolInput } from "./NoteCard";
import { renderSpeakingBlockquote } from "./SpeakingPhrase";
import { AiChatSidebar } from "./AiChatSidebar";
import { AiChatComposer } from "./AiChatComposer";
import { useAiChatSession, PRESET_IDS } from "./useAiChatSession";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, Bot, ChevronDown, Eraser, FilePlus2, PlugZap, Unplug } from "lucide-react";
import { useNavStore } from "@/store/navStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useWordModalStore } from "@/store/wordModalStore";
import { usePendingChatSelectionStore } from "@/store/pendingChatSelectionStore";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { buildPresetPrompt } from "./aiChatHelpers";

const lookupWord = (word: string) => useWordModalStore.getState().openWordModal(word);

export function AiChatPage({ initialSessionId, onActiveIdChange }: { initialSessionId?: string; onActiveIdChange?: (id: string | null) => void } = {}) {
  const t = useT();
  const s = useAiChatSession(initialSessionId);
  // Lets a wrapping modal know which session is actually on screen (the user
  // may switch sessions inside it), e.g. for its expand-to-full-page button.
  React.useEffect(() => { onActiveIdChange?.(s.activeId); }, [s.activeId, onActiveIdChange]);
  const navigate = useNavStore((state) => state.navigate);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => localStorage.getItem("aichat-sidebar-collapsed") === "1");
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [promptExpanded, setPromptExpanded] = React.useState(
    () => localStorage.getItem("aichat-prompt-expanded") === "1"
  );
  const isSpeakingCoach = s.selectedPreset === "speaking-coach";

  React.useEffect(() => {
    const pending = usePendingChatSelectionStore.getState().consume();
    if (pending) {
      s.setInput(t("sel.askPrefill", { text: pending }));
      window.setTimeout(() => s.textareaRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.setInput, t]);

  const messages = React.useMemo(() => s.displayItems.flatMap((item) => item.kind === "message" ? [item.msg] : []), [s.displayItems]);
  const activeProvider = s.providers.find((provider) => provider.id === s.selectedProviderId) ?? s.providers[0];
  // With a wallpaper set, the app canvas is transparent (see AppBackground) —
  // this page must not paint over it. Without one it still needs a surface.
  const hasCustomAppBackground = useSettingsStore((state) => !!state.appBackgroundImage && state.appBackgroundVisible);
  const toggleSidebar = () => setSidebarCollapsed((current) => {
    localStorage.setItem("aichat-sidebar-collapsed", current ? "0" : "1");
    return !current;
  });
  const togglePrompt = () => setPromptExpanded((current) => {
    localStorage.setItem("aichat-prompt-expanded", current ? "0" : "1");
    return !current;
  });
  React.useEffect(() => {
    const onNewChat = () => s.startNew();
    const onLearnArticle = (e: Event) => {
      const detail = (e as CustomEvent<{ title: string; text: string; commentsText?: string }>).detail;
      if (detail) s.startWithArticle(detail);
    };
    // Raised by the global selection toolbar when the text was picked out of
    // an AI reply — that follow-up belongs in the conversation, not in a card.
    const onAskSelection = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      s.setInput(t("sel.askPrefill", { text: detail.text }));
      s.textareaRef.current?.focus();
    };
    const onOpenChat = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string }>).detail;
      if (detail?.sessionId) s.switchSession(detail.sessionId);
    };
    window.addEventListener("tanwords:new-chat", onNewChat);
    window.addEventListener("tanwords:learn-article", onLearnArticle);
    window.addEventListener("tanwords:open-chat", onOpenChat);
    window.addEventListener("tanwords:ask-selection", onAskSelection);
    return () => {
      window.removeEventListener("tanwords:new-chat", onNewChat);
      window.removeEventListener("tanwords:learn-article", onLearnArticle);
      window.removeEventListener("tanwords:open-chat", onOpenChat);
      window.removeEventListener("tanwords:ask-selection", onAskSelection);
    };
  }, [s.startNew, s.startWithArticle, s.switchSession]);

  return (
    <div className={`flex h-full overflow-hidden ${hasCustomAppBackground ? "" : "bg-background"}`}>
      <AiChatSidebar
        displaySessions={s.displaySessions}
        archivedSessions={s.archivedSessions}
        searchQuery={s.searchQuery}
        onSearchChange={s.setSearchQuery}
        dateFrom={s.dateFrom}
        dateTo={s.dateTo}
        onDateRangeChange={s.setDateRange}
        activeId={s.activeId}
        onSwitchSession={s.switchSession}
        onDeleteSession={s.deleteSession}
        onToggleArchived={s.toggleArchived}
        onTogglePinned={s.togglePinned}
        onRenameSession={s.renameSession}
        onNewChat={s.startNew}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      />

      <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
        {/* Compact icon-led session toolbar */}
        <div className="flex items-center gap-2 px-5 h-16 border-b border-border/60 bg-background/65 backdrop-blur-xl shrink-0">
          <div className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold tracking-tight text-foreground">{s.isNewSession ? t("aichat.newChat") : s.activeTitle}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{messages.length ? t("aichat.messageCount", { count: messages.length }) : t("aichat.ready")}</span></div>
          {/* The selector is the connection indicator: it already names the
            * provider in use, so a separate "connected" light beside it said
            * the same thing twice and squeezed the model name into an
            * ellipsis. The plug lives in the trigger instead, and the label
            * shows the model id — that's what you're actually choosing. */}
          {s.providers.length > 0 ? (
            <Select value={s.selectedProviderId} onValueChange={s.setSelectedProviderId}>
              <SelectTrigger
                title={activeProvider ? `${activeProvider.name} · ${activeProvider.modelId}` : t("aichat.toolbarModel")}
                aria-label={t("aichat.toolbarModel")}
                className="h-9 w-auto max-w-[240px] gap-2 rounded-xl border-border/70 bg-card/70 px-2.5 text-xs shadow-none focus:ring-1 focus:ring-primary/20 shrink-0"
              >
                <PlugZap className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <SelectValue>{activeProvider?.modelId || activeProvider?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {s.providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-baseline gap-2"><span>{p.name}</span><span className="text-[10px] text-muted-foreground">{p.modelId}</span></span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button variant="ghost" onClick={() => navigate("settings")} title={t("aichat.providerDisconnected")} aria-label={t("aichat.providerDisconnected")} className="h-9 gap-2 rounded-xl px-2.5 text-xs font-medium text-amber-500 hover:bg-amber-500/10 hover:text-amber-500 shrink-0">
              <Unplug className="h-3.5 w-3.5" />
              {t("aichat.providerDisconnected")}
            </Button>
          )}
          {s.displayItems.length > 0 && (
            <>
              <Button
                variant="ghost"
                onClick={s.summarizeAndSave}
                disabled={s.streaming}
                title={t("aichat.summarizeAndSaveHint")}
                className="h-9 gap-1.5 rounded-xl px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{t("aichat.summarizeAndSave")}</span>
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(true)} title={t("aichat.clear")} aria-label={t("aichat.clear")} className="h-9 w-9 rounded-xl p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0">
                <Eraser className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {/* Tutor and its effective system prompt live together, directly above
          * the conversation. The role stays switchable while collapsed; expanding
          * reveals the exact prompt that will be sent and makes it editable. */}
        <section className="border-b border-border/60 bg-background/40 backdrop-blur-md shrink-0">
          <div className="flex min-h-12 items-center gap-2 px-5">
            <Bot className="h-4 w-4 shrink-0 text-primary" />
            <Select value={s.selectedPreset} onValueChange={(v) => s.setSelectedPreset(v)}>
              <SelectTrigger
                title={t("aichat.toolbarMode")}
                aria-label={t("aichat.toolbarMode")}
                className="h-8 w-auto min-w-[150px] max-w-[220px] gap-2 border-0 bg-transparent px-1 text-sm font-medium shadow-none hover:text-primary focus:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_IDS.map((id) => (
                  <SelectItem key={id} value={id}>{t(`aichat.preset.${id}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={togglePrompt}
              aria-expanded={promptExpanded}
              aria-label={t("aichat.promptView")}
              title={t("aichat.promptView")}
              className="ml-auto flex h-8 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <span>{t("aichat.promptTitle")}</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${promptExpanded ? "rotate-180" : ""}`} />
            </button>
          </div>
          {promptExpanded && (
            <div className="border-t border-border/50 px-5 pb-4 pt-3">
              <div className="mx-auto max-w-5xl">
                <p className="mb-2 text-xs text-muted-foreground">{t("aichat.promptDescription")}</p>
                <textarea
                  value={s.customPrompt}
                  onChange={(e) => s.setCustomPrompt(e.target.value)}
                  placeholder={t("aichat.customPromptPlaceholder")}
                  rows={8}
                  className="max-h-[40vh] min-h-32 w-full resize-y rounded-xl border border-input bg-muted/20 px-4 py-3 font-mono text-xs leading-relaxed placeholder:text-muted-foreground/40 focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    disabled={s.selectedPreset === "custom"}
                    onClick={() => s.setCustomPrompt(buildPresetPrompt(s.selectedPreset, useSettingsStore.getState().targetLevels.join("/")))}
                    className="h-8 text-xs text-muted-foreground"
                  >
                    {t("aichat.promptReset")}
                  </Button>
                  <Button size="sm" className="h-8" onClick={togglePrompt}>
                    {t("aichat.promptDone")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Messages */}
        <div className="relative flex-1 min-h-0">
          <div ref={s.scrollHostRef} className="h-full overflow-y-auto px-5 py-7">
            <div className="mx-auto max-w-full space-y-5">
          {s.displayItems.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <p className="text-sm font-semibold text-foreground/80">{t("aichat.emptyTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("aichat.emptyHint")}</p>
            </div>
          ) : (
            s.displayItems.map((item, idx) => {
              if (item.kind === "tool_block") {
                const extractCalls = item.calls.filter((c) => VOCAB_CARD_TOOL_NAMES.has(c.name));
                const sentenceCalls = item.calls.filter((c) => SENTENCE_CARD_TOOL_NAMES.has(c.name));
                const noteCalls = item.calls.filter((c) => NOTE_CARD_TOOL_NAMES.has(c.name));
                const otherCalls = item.calls.filter((c) =>
                  !VOCAB_CARD_TOOL_NAMES.has(c.name) && !SENTENCE_CARD_TOOL_NAMES.has(c.name) && !NOTE_CARD_TOOL_NAMES.has(c.name)
                );
                const saveCall = otherCalls.find((c) => c.name === "save_note_as_document");
                // Mirrors MessageBubble's own box model exactly (avatar-width
                // spacer + gap-3, content capped at min(82%,48rem)) so a tool call
                // sitting between two AI messages lines up on both edges, not
                // just the left one.
                return (
                  <div key={idx} className="flex gap-3">
                    <div className="w-10 h-10 shrink-0" />
                    <div className="min-w-0 flex-1 max-w-[min(82%,48rem)] flex flex-col gap-5">
                      {extractCalls.map((c) => (
                        <VocabExtractionCard
                          key={c.id}
                          items={vocabItemsFromToolInput(c.input)}
                        />
                      ))}
                      {sentenceCalls.map((c) => (
                        <SentenceExtractionCard
                          key={c.id}
                          items={sentenceItemsFromToolInput(c.input)}
                          variant={c.name === "extract_patterns" ? "extracted" : "generated"}
                        />
                      ))}
                      {noteCalls.map((c) => (
                        <NoteCard
                          key={c.id}
                          note={noteFromToolInput(c.input)}
                          alreadySaved={!!saveCall && !saveCall.is_error}
                        />
                      ))}
                      {otherCalls.length > 0 && <ToolCallCard calls={otherCalls} />}
                    </div>
                  </div>
                );
              }
              const isTyping =
                s.streaming &&
                idx === s.displayItems.length - 1 &&
                item.msg.role === "assistant" &&
                !item.msg.content;
              // A turn that was purely a tool call (see tool_block above) has no
              // text of its own — nothing to render once it's done streaming.
              if (!isTyping && item.msg.role === "assistant" && !item.msg.content.trim()) return null;
              // A message right after a tool card (e.g. the vocab card's follow-up
              // explanation) fills the same width instead of shrink-wrapping, so
              // the two line up as one continuous block.
              const fillCardWidth = idx > 0 && s.displayItems[idx - 1]?.kind === "tool_block";
              const isLastAssistant = item.msg.role === "assistant" && idx === s.displayItems.length - 1;
              return (
                <MessageBubble
                  key={idx}
                  msg={item.msg}
                  isTyping={isTyping}
                  fillCardWidth={fillCardWidth}
                  index={idx}
                  onEdit={item.msg.role === "user" && !s.streaming ? s.editUserMessage : undefined}
                  onRegenerate={isLastAssistant && s.canRegenerate ? s.regenerate : undefined}
                  renderBlockquote={isSpeakingCoach ? renderSpeakingBlockquote : undefined}
                  onWordClick={isSpeakingCoach ? lookupWord : undefined}
                />
              );
            })
          )}
            <div ref={s.bottomRef} />
            </div>
          </div>

          {s.showScrollToBottom && (
            <Button
              variant="outline"
              onClick={s.scrollToBottom}
              title={t("aichat.scrollToBottom")}
              aria-label={t("aichat.scrollToBottom")}
              className="absolute bottom-4 left-1/2 z-10 h-9 w-9 -translate-x-1/2 rounded-full border-border/80 bg-background/90 p-0 text-muted-foreground shadow-lg backdrop-blur-md hover:bg-background hover:text-foreground"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          )}
        </div>

        <AiChatComposer
          input={s.input}
          onInputChange={s.setInput}
          onPaste={s.handlePaste}
          onSend={() => s.sendMessage()}
          streaming={s.streaming}
          onStop={s.handleStop}
          attachment={s.attachment}
          onRemoveAttachment={() => { s.setAttachment(null); s.setShowAttachment(false); }}
          showAttachment={s.showAttachment}
          onToggleShowAttachment={() => s.setShowAttachment((v) => !v)}
          showTools={s.showTools}
          onToggleTools={() => s.setShowTools((v) => !v)}
          enabledGroups={s.enabledGroups}
          onToggleGroup={s.toggleGroup}
          tokenCount={s.tokenCount}
          textareaRef={s.textareaRef}
        />
      </main>
      <ConfirmModal
        open={confirmClear}
        title={t("aichat.clearConfirmTitle")}
        message={t("aichat.clearConfirmMessage")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => { setConfirmClear(false); void s.clearMessages(); }}
      />
    </div>
  );
}
