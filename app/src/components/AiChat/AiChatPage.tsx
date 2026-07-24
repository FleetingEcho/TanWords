import React from "react";
import { useT } from "@/hooks/useT";
import { MessageBubble } from "./MessageBubble";
import { ToolCallCard } from "./ToolCallCard";
import { VocabExtractionCard, ExtractedVocabItem } from "./VocabExtractionCard";
import { AiChatSidebar } from "./AiChatSidebar";
import { AiChatComposer } from "./AiChatComposer";
import { useAiChatSession, PRESET_IDS } from "./useAiChatSession";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChatDigestPanel } from "./ChatDigestPanel";
import { Bot, Eraser, PanelRightOpen, PlugZap, Settings, Sparkles, Unplug } from "lucide-react";
import { useNavStore } from "@/store/navStore";
import { useSettingsStore } from "@/store/settingsStore";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { buildPresetPrompt } from "./aiChatHelpers";

export function AiChatPage() {
  const t = useT();
  const s = useAiChatSession();
  const navigate = useNavStore((state) => state.navigate);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => localStorage.getItem("aichat-sidebar-collapsed") === "1");
  const [digestOpen, setDigestOpen] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const messages = React.useMemo(() => s.displayItems.flatMap((item) => item.kind === "message" ? [item.msg] : []), [s.displayItems]);
  const activeProvider = s.providers.find((provider) => provider.id === s.selectedProviderId) ?? s.providers[0];
  const toggleSidebar = () => setSidebarCollapsed((current) => {
    localStorage.setItem("aichat-sidebar-collapsed", current ? "0" : "1");
    return !current;
  });
  React.useEffect(() => {
    const onNewChat = () => s.startNew();
    const onDigest = () => setDigestOpen(true);
    const onLearnArticle = (e: Event) => {
      const detail = (e as CustomEvent<{ title: string; text: string; commentsText?: string }>).detail;
      if (detail) s.startWithArticle(detail);
    };
    const onOpenChat = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string }>).detail;
      if (detail?.sessionId) s.switchSession(detail.sessionId);
    };
    window.addEventListener("tanwords:new-chat", onNewChat);
    window.addEventListener("tanwords:conversation-note", onDigest);
    window.addEventListener("tanwords:learn-article", onLearnArticle);
    window.addEventListener("tanwords:open-chat", onOpenChat);
    return () => {
      window.removeEventListener("tanwords:new-chat", onNewChat);
      window.removeEventListener("tanwords:conversation-note", onDigest);
      window.removeEventListener("tanwords:learn-article", onLearnArticle);
      window.removeEventListener("tanwords:open-chat", onOpenChat);
    };
  }, [s.startNew, s.startWithArticle, s.switchSession]);

  return (
    <div className="flex h-full overflow-hidden bg-background bg-[radial-gradient(circle_at_55%_-20%,hsl(var(--primary)/.09),transparent_38%)]">
      <AiChatSidebar
        displaySessions={s.displaySessions}
        grouped={s.grouped}
        searchQuery={s.searchQuery}
        onSearchChange={s.setSearchQuery}
        activeId={s.activeId}
        onSwitchSession={s.switchSession}
        onDeleteSession={s.deleteSession}
        onNewChat={s.startNew}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      />

      <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
        {/* Compact icon-led session toolbar */}
        <div className="flex items-center gap-2 px-5 h-16 border-b border-border/60 bg-background/65 backdrop-blur-xl shrink-0">
          <div className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold tracking-tight text-foreground">{s.isNewSession ? t("aichat.newChat") : s.activeTitle}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{messages.length ? t("aichat.messageCount", { count: messages.length }) : t("aichat.ready")}</span></div>
          <Select value={s.selectedPreset} onValueChange={(v) => s.setSelectedPreset(v)}>
            <SelectTrigger title={t("aichat.toolbarMode")} aria-label={t("aichat.toolbarMode")} className="h-9 w-auto max-w-[160px] gap-2 rounded-xl border-border/70 bg-card/70 px-2.5 text-xs shadow-none focus:ring-1 focus:ring-primary/20 shrink-0">
              <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_IDS.map((id) => (
                <SelectItem key={id} value={id}>{t(`aichat.preset.${id}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={() => setPromptOpen(true)} title={t("aichat.promptView")} aria-label={t("aichat.promptView")} className="h-9 w-9 rounded-xl p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary shrink-0">
            <Settings className="h-4 w-4" />
          </Button>
          <div className="mx-0.5 h-5 w-px bg-border/70" />
          {activeProvider ? <div title={t("aichat.providerConnected")} aria-label={t("aichat.providerConnected")} className="grid h-9 w-9 place-items-center rounded-xl text-emerald-500"><PlugZap className="h-4 w-4" /><span className="sr-only">{t("aichat.providerConnected")}</span></div> : <Button variant="ghost" onClick={() => navigate("settings")} title={t("aichat.providerDisconnected")} aria-label={t("aichat.providerDisconnected")} className="h-9 w-9 rounded-xl p-0 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"><Unplug className="h-4 w-4" /></Button>}
          <Button variant="ghost" onClick={() => setDigestOpen(true)} disabled={messages.length < 2 || s.streaming} title={t("aichat.createDigest")} aria-label={t("aichat.createDigest")} className="h-9 w-9 rounded-xl p-0 text-primary hover:bg-primary/10">
            {digestOpen ? <PanelRightOpen className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </Button>
          {s.displayItems.length > 0 && (
            <Button variant="ghost" onClick={() => setConfirmClear(true)} title={t("aichat.clear")} aria-label={t("aichat.clear")} className="h-9 w-9 rounded-xl p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0">
              <Eraser className="h-4 w-4" />
            </Button>
          )}
          {!activeProvider && <Button variant="ghost" onClick={() => navigate("settings")} title={t("aichat.openSettings")} aria-label={t("aichat.openSettings")} className="h-9 w-9 rounded-xl p-0 text-muted-foreground"><Settings className="h-4 w-4" /></Button>}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-7 min-h-0 scroll-smooth">
          <div className="mx-auto max-w-3xl space-y-5">
          {s.displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5">
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground/80">{t("aichat.emptyTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("aichat.emptyHint")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
                {s.QUICK_CARDS.map((c) => (
                  <Button
                    key={c.titleKey}
                    variant="ghost"
                    onClick={() => s.applyQuickCard(c.prefillKey)}
                    className="h-auto flex items-center justify-start gap-2.5 px-4 py-3 rounded-xl border border-border bg-card text-left hover:border-primary/40 hover:bg-muted/40 transition-colors"
                  >
                    <c.icon className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium">{t(c.titleKey)}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            s.displayItems.map((item, idx) => {
              if (item.kind === "tool_block") {
                const extractCalls = item.calls.filter((c) => c.name === "extract_vocabulary");
                const otherCalls = item.calls.filter((c) => c.name !== "extract_vocabulary");
                // Mirrors MessageBubble's own box model exactly (avatar-width
                // spacer + gap-3, content capped at max-w-[82%]) so a tool call
                // sitting between two AI messages lines up on both edges, not
                // just the left one.
                return (
                  <div key={idx} className="flex gap-3">
                    <div className="w-6 h-6 shrink-0" />
                    <div className="min-w-0 max-w-[82%] flex flex-col gap-5">
                      {extractCalls.map((c) => (
                        <VocabExtractionCard
                          key={c.id}
                          items={((c.input.items as ExtractedVocabItem[]) ?? [])}
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
              return <MessageBubble key={idx} msg={item.msg} isTyping={isTyping} />;
            })
          )}
          <div ref={s.bottomRef} />
          </div>
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
      <ChatDigestPanel open={digestOpen} onClose={() => setDigestOpen(false)} messages={messages} provider={activeProvider} sessionTitle={s.activeTitle} />
      <ConfirmModal
        open={confirmClear}
        title={t("aichat.clearConfirmTitle")}
        message={t("aichat.clearConfirmMessage")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => { setConfirmClear(false); void s.clearMessages(); }}
      />
      <Dialog open={promptOpen} onClose={() => setPromptOpen(false)} maxWidth="max-w-2xl" className="overflow-hidden">
        <div className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-base font-semibold">{t("aichat.promptTitle")}</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("aichat.promptDescription")}</p>
        </div>
        <div className="p-6">
          <textarea
            value={s.customPrompt}
            onChange={(e) => s.setCustomPrompt(e.target.value)}
            placeholder={t("aichat.customPromptPlaceholder")}
            rows={14}
            autoFocus
            className="w-full resize-y rounded-xl border border-input bg-muted/20 px-4 py-3 font-mono text-sm leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              disabled={s.selectedPreset === "custom"}
              onClick={() => s.setCustomPrompt(buildPresetPrompt(s.selectedPreset, useSettingsStore.getState().targetLevels.join("/")))}
              className="text-xs text-muted-foreground"
            >
              {t("aichat.promptReset")}
            </Button>
            <Button onClick={() => setPromptOpen(false)}>{t("aichat.promptDone")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
