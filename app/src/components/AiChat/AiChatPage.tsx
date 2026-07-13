import React from "react";
import { useT } from "@/hooks/useT";
import { MessageBubble } from "./MessageBubble";
import { ToolCallCard } from "./ToolCallCard";
import { VocabExtractionCard, ExtractedVocabItem } from "./VocabExtractionCard";
import { AiChatSidebar } from "./AiChatSidebar";
import { AiChatComposer } from "./AiChatComposer";
import { useAiChatSession, PRESET_IDS } from "./useAiChatSession";

export function AiChatPage() {
  const t = useT();
  const s = useAiChatSession();

  return (
    <div className="flex h-full bg-background">
      <AiChatSidebar
        displaySessions={s.displaySessions}
        grouped={s.grouped}
        searchQuery={s.searchQuery}
        onSearchChange={s.setSearchQuery}
        activeId={s.activeId}
        onSwitchSession={s.switchSession}
        onDeleteSession={s.deleteSession}
        onNewChat={s.startNew}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar: title + instant preset/provider selects */}
        <div className="flex items-center gap-2 px-5 h-14 border-b border-border shrink-0">
          <span className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate">
            {s.isNewSession ? t("aichat.newChat") : s.activeTitle}
          </span>
          <select
            value={s.selectedPreset}
            onChange={(e) => s.setSelectedPreset(e.target.value)}
            className="h-8 px-2 text-xs rounded-lg border border-input bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 shrink-0"
          >
            {PRESET_IDS.map((id) => (
              <option key={id} value={id}>{t(`aichat.preset.${id}`)}</option>
            ))}
          </select>
          <select
            value={s.selectedProviderId}
            onChange={(e) => s.setSelectedProviderId(e.target.value)}
            className="h-8 px-2 text-xs rounded-lg border border-input bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 shrink-0 max-w-[180px]"
          >
            {s.providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.modelId}</option>)}
            {s.providers.length === 0 && <option disabled>{t("aichat.noProvider")}</option>}
          </select>
          {s.displayItems.length > 0 && (
            <button onClick={s.clearMessages} className="px-3 h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-muted rounded-lg transition-colors shrink-0">
              {t("aichat.clear")}
            </button>
          )}
        </div>

        {/* Custom system prompt (only for the Custom preset) */}
        {s.selectedPreset === "custom" && (
          <div className="shrink-0 border-b border-border px-5 py-3">
            <textarea
              value={s.customPrompt}
              onChange={(e) => s.setCustomPrompt(e.target.value)}
              placeholder={t("aichat.customPromptPlaceholder")}
              rows={3}
              className="w-full resize-none px-3 py-2 text-xs rounded-xl border border-input bg-background placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
            />
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 min-h-0">
          {s.displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5">
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground/80">{t("aichat.emptyTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("aichat.emptyHint")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
                {s.QUICK_CARDS.map((c) => (
                  <button
                    key={c.titleKey}
                    onClick={() => s.applyQuickCard(c.prefillKey)}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-border bg-card text-left hover:border-primary/40 hover:bg-muted/40 transition-colors"
                  >
                    <c.icon className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium">{t(c.titleKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            s.displayItems.map((item, idx) => {
              if (item.kind === "tool_block") {
                const extractCalls = item.calls.filter((c) => c.name === "extract_vocabulary");
                const otherCalls = item.calls.filter((c) => c.name !== "extract_vocabulary");
                return (
                  <React.Fragment key={idx}>
                    {extractCalls.map((c) => (
                      <VocabExtractionCard
                        key={c.id}
                        items={((c.input.items as ExtractedVocabItem[]) ?? [])}
                      />
                    ))}
                    {otherCalls.length > 0 && <ToolCallCard calls={otherCalls} />}
                  </React.Fragment>
                );
              }
              const isTyping =
                s.streaming &&
                idx === s.displayItems.length - 1 &&
                item.msg.role === "assistant" &&
                !item.msg.content;
              return <MessageBubble key={idx} msg={item.msg} isTyping={isTyping} />;
            })
          )}
          <div ref={s.bottomRef} />
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
      </div>
    </div>
  );
}

