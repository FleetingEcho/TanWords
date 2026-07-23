import React from "react";
import { useT } from "@/hooks/useT";
import { MessageBubble } from "@/components/AiChat/MessageBubble";
import { ToolCallCard } from "@/components/AiChat/ToolCallCard";
import { VocabExtractionCard, ExtractedVocabItem } from "@/components/AiChat/VocabExtractionCard";
import { AiChatComposer } from "@/components/AiChat/AiChatComposer";
import { useAiChatSession, PRESET_IDS } from "@/components/AiChat/useAiChatSession";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ToolsModalChatTabProps {
  active: boolean;
  chat: ReturnType<typeof useAiChatSession>;
}

/** AI Chat tab body: preset/provider selectors, custom prompt, message list, and composer. */
export function ToolsModalChatTab({ active, chat }: ToolsModalChatTabProps) {
  const t = useT();

  return (
    <div style={{ display: active ? "flex" : "none", height: "100%" }} className="flex-col overflow-hidden">
      {/* Top bar: preset + provider + settings */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0" onPointerDown={(e) => e.stopPropagation()}>
        <Select value={chat.selectedPreset} onValueChange={(v) => chat.setSelectedPreset(v)}>
          <SelectTrigger className="h-6 w-auto gap-1 px-1.5 text-[10px] rounded border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 [&_svg]:h-3 [&_svg]:w-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_IDS.map((id) => (
              <SelectItem key={id} value={id}>{t(`aichat.preset.${id}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={chat.selectedProviderId} onValueChange={(v) => chat.setSelectedProviderId(v)} disabled={chat.providers.length === 0}>
          <SelectTrigger className="h-6 w-auto gap-1 px-1.5 text-[10px] rounded border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 max-w-[140px] [&_svg]:h-3 [&_svg]:w-3">
            <SelectValue placeholder={t("aichat.noProvider")} />
          </SelectTrigger>
          <SelectContent>
            {chat.providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.modelId}</SelectItem>)}
          </SelectContent>
        </Select>
        {chat.displayItems.length > 0 && (
          <Button variant="ghost" onClick={chat.clearMessages} className="ml-auto h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive hover:bg-muted rounded transition-colors shrink-0">
            {t("aichat.clear")}
          </Button>
        )}
      </div>

      {/* Custom system prompt */}
      {chat.selectedPreset === "custom" && (
        <div className="shrink-0 border-b border-border px-3 py-2" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            value={chat.customPrompt}
            onChange={(e) => chat.setCustomPrompt(e.target.value)}
            placeholder={t("aichat.customPromptPlaceholder")}
            rows={2}
            className="w-full resize-none px-2.5 py-1.5 text-[11px] rounded-lg border border-input bg-background placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 leading-relaxed"
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {chat.displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground/80">{t("aichat.emptyTitle")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("aichat.emptyHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-[360px]">
              {chat.QUICK_CARDS.map((c) => (
                <Button
                  key={c.titleKey}
                  variant="ghost"
                  onClick={() => chat.applyQuickCard(c.prefillKey)}
                  className="h-auto flex items-center justify-start gap-2 px-3 py-2.5 rounded-xl border border-border bg-card text-left hover:border-primary/40 hover:bg-muted/40 transition-colors"
                >
                  <c.icon className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[11px] font-medium">{t(c.titleKey)}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          chat.displayItems.map((item, idx) => {
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
              chat.streaming &&
              idx === chat.displayItems.length - 1 &&
              item.msg.role === "assistant" &&
              !item.msg.content;
            return <MessageBubble key={idx} msg={item.msg} isTyping={isTyping} />;
          })
        )}
        <div ref={chat.bottomRef} />
      </div>

      {/* Composer */}
      <div onPointerDown={(e) => e.stopPropagation()}>
        <AiChatComposer
          input={chat.input}
          onInputChange={chat.setInput}
          onPaste={chat.handlePaste}
          onSend={() => chat.sendMessage()}
          streaming={chat.streaming}
          onStop={chat.handleStop}
          attachment={chat.attachment}
          onRemoveAttachment={() => { chat.setAttachment(null); chat.setShowAttachment(false); }}
          showAttachment={chat.showAttachment}
          onToggleShowAttachment={() => chat.setShowAttachment((v) => !v)}
          showTools={chat.showTools}
          onToggleTools={() => chat.setShowTools((v) => !v)}
          enabledGroups={chat.enabledGroups}
          onToggleGroup={chat.toggleGroup}
          tokenCount={chat.tokenCount}
          textareaRef={chat.textareaRef}
        />
      </div>
    </div>
  );
}
