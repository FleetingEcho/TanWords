import React from "react";
import { useT } from "@/hooks/useT";
import { TOOL_GROUPS, ToolGroupKey } from "./tools";
import { BookIcon, DocIcon, CloseIcon } from "@/components/ui/icons";
import { CheckIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";

const GROUP_ICONS: Record<ToolGroupKey, React.FC<{ className?: string }>> = {
  vocabulary: BookIcon,
  documents: DocIcon,
};

interface Props {
  input: string;
  onInputChange: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  streaming: boolean;
  onStop: () => void;
  attachment: string | null;
  onRemoveAttachment: () => void;
  showAttachment: boolean;
  onToggleShowAttachment: () => void;
  showTools: boolean;
  onToggleTools: () => void;
  enabledGroups: Set<ToolGroupKey>;
  onToggleGroup: (g: ToolGroupKey) => void;
  tokenCount: number;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

export function AiChatComposer({
  input, onInputChange, onPaste, onSend, streaming, onStop,
  attachment, onRemoveAttachment, showAttachment, onToggleShowAttachment,
  showTools, onToggleTools, enabledGroups, onToggleGroup,
  tokenCount, textareaRef,
}: Props) {
  const t = useT();

  return (
    <div className="shrink-0 border-t border-border px-6 py-4">
      {/* Attachment chip */}
      {attachment && (
        <div className="mb-2">
          <div className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg bg-muted/60 border border-border text-xs">
            <DocIcon className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-medium">{t("aichat.attachment", { n: attachment.length })}</span>
            <Button variant="link" onClick={onToggleShowAttachment} className="h-auto p-0 text-primary hover:underline font-semibold">
              {showAttachment ? t("aichat.attachHide") : t("aichat.attachView")}
            </Button>
            <Button
              variant="ghost"
              onClick={onRemoveAttachment}
              className="w-4 h-4 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive"
            >
              <CloseIcon className="w-3 h-3" />
            </Button>
          </div>
          {showAttachment && (
            <div className="mt-2 max-h-40 overflow-y-auto px-3 py-2 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {attachment}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 items-end">
        {/* Tools popover */}
        <div className="relative shrink-0">
          <Button
            variant="ghost"
            onClick={onToggleTools}
            title={t("aichat.tools")}
            className={`w-10 h-10 p-0 rounded-xl border flex items-center justify-center transition-colors ${
              enabledGroups.size > 0
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" strokeLinejoin="round" />
              <path d="M11.5 5.5l3 3" />
            </svg>
          </Button>
          {showTools && (
            <>
              <div className="fixed inset-0 z-10" onClick={onToggleTools} />
              <div className="absolute bottom-12 left-0 z-20 w-56 p-3 rounded-xl border border-border bg-card shadow-xl space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{t("aichat.tools")}</p>
                {(Object.keys(TOOL_GROUPS) as ToolGroupKey[]).map((g) => {
                  const active = enabledGroups.has(g);
                  return (
                    <Button
                      key={g}
                      variant="ghost"
                      onClick={() => onToggleGroup(g)}
                      className={`h-auto w-full flex items-center justify-start gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors border ${
                        active
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                          : "bg-muted/40 border-border text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {React.createElement(GROUP_ICONS[g], { className: "w-3.5 h-3.5 shrink-0" })}
                      <span className="flex-1 text-left">{TOOL_GROUPS[g].label}</span>
                      {active && <CheckIcon className="w-3.5 h-3.5 text-emerald-500" />}
                    </Button>
                  );
                })}
                {enabledGroups.size === 0 && (
                  <p className="text-[10px] text-muted-foreground/50">{t("aichat.toolsNone")}</p>
                )}
              </div>
            </>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder={enabledGroups.size > 0 ? t("aichat.placeholder") : t("aichat.placeholderPlain")}
          rows={1}
          disabled={streaming}
          className="flex-1 resize-none px-4 py-2.5 text-sm rounded-xl border border-input bg-card placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 leading-relaxed min-h-[40px]"
        />

        {streaming ? (
          <Button
            variant="ghost"
            onClick={onStop}
            className="shrink-0 h-10 px-4 rounded-xl text-sm font-semibold bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors flex items-center gap-2"
          >
            <span className="w-2.5 h-2.5 rounded-[2px] bg-destructive" />
            {t("aichat.stop")}
          </Button>
        ) : (
          <Button
            onClick={onSend}
            disabled={!input.trim() && !attachment}
            className="shrink-0 h-10 px-4 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {t("aichat.send")}
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 1.5l13 6.5-13 6.5V9.5l9-3-9-3V1.5z" /></svg>
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 px-1">
        <p className="text-[10px] text-muted-foreground/50">{t("aichat.inputHint")}</p>
        {tokenCount > 0 && <p className="text-[10px] text-muted-foreground/50">~{tokenCount.toLocaleString()} tokens</p>}
      </div>
    </div>
  );
}
