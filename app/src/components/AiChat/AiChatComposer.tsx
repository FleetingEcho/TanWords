import React from "react";
import { useT } from "@/hooks/useT";
import { TOOL_GROUPS, ToolGroupKey } from "./tools";
import { BookIcon, DocIcon, CloseIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

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
    <div className="shrink-0 border-t border-border/60 bg-background/75 px-2 py-3 backdrop-blur-xl">
      <div className="mx-auto max-w-full">
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

      <div className="rounded-[22px] border border-border/70 bg-card/95 p-2 shadow-[0_14px_45px_-28px_rgba(0,0,0,.55)] transition-colors focus-within:border-primary/30">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder={enabledGroups.size > 0 ? t("aichat.placeholder") : t("aichat.placeholderPlain")}
          rows={1}
          disabled={streaming}
          className="block min-h-[42px] max-h-40 w-full resize-none bg-transparent px-3 pb-2 pt-2 text-sm leading-6 placeholder:text-muted-foreground/35 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center gap-2 px-1">
        <div className="relative">
          <Button
            variant="ghost"
            onClick={onToggleTools}
            title={t("aichat.accessTitle")}
            className={`h-8 gap-1.5 rounded-xl px-2.5 text-[11px] font-medium transition-colors ${
              enabledGroups.size > 0
                ? "bg-primary/[0.08] text-primary hover:bg-primary/[0.12]"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t("aichat.accessButton")}</span>
            {enabledGroups.size > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary/10 px-1 text-[9px] font-bold">{enabledGroups.size}</span>}
          </Button>
          {showTools && (
            <>
              <div className="fixed inset-0 z-10" onClick={onToggleTools} />
              <div className="absolute bottom-10 left-0 z-20 w-72 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl">
                <div className="border-b border-border/60 px-4 py-3.5">
                  <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold">{t("aichat.accessTitle")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{t("aichat.accessSubtitle")}</p></div></div>
                </div>
                <div className="space-y-1 p-2">
                {(Object.keys(TOOL_GROUPS) as ToolGroupKey[]).map((g) => {
                  const active = enabledGroups.has(g);
                  return (
                    <button
                      key={g}
                      onClick={() => onToggleGroup(g)}
                      role="switch"
                      aria-checked={active}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-muted/60"
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{React.createElement(GROUP_ICONS[g], { className: "w-4 h-4" })}</span>
                      <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{t(`aichat.access.${g}.title`)}</span><span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{t(`aichat.access.${g}.description`)}</span></span>
                      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${active ? "bg-primary" : "bg-muted-foreground/25"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${active ? "translate-x-[18px]" : "translate-x-0.5"}`} /></span>
                    </button>
                  );
                })}
                </div>
                <div className="border-t border-border/60 bg-muted/20 px-4 py-2.5"><p className="text-[9px] leading-4 text-muted-foreground">{enabledGroups.size === 0 ? t("aichat.accessNone") : t("aichat.accessHint")}</p></div>
              </div>
            </>
          )}
        </div>
        <span className="ml-auto hidden text-[10px] text-muted-foreground/45 sm:block">{t("aichat.inputHint")}</span>

        {streaming ? (
          <Button
            variant="ghost"
            onClick={onStop}
            className="h-8 shrink-0 gap-2 rounded-xl bg-destructive/10 px-3 text-xs font-semibold text-destructive hover:bg-destructive/15"
          >
            <span className="w-2.5 h-2.5 rounded-[2px] bg-destructive" />
            {t("aichat.stop")}
          </Button>
        ) : (
          <Button
            onClick={onSend}
            disabled={!input.trim() && !attachment}
            className="h-8 shrink-0 gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-sm shadow-primary/20 disabled:shadow-none"
          >
            {t("aichat.send")}
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 1.5l13 6.5-13 6.5V9.5l9-3-9-3V1.5z" /></svg>
          </Button>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
