import React from "react";
import { useT } from "@/hooks/useT";
import { TOOL_GROUPS, ToolGroupKey } from "./tools";
import { TOOL_LABELS } from "./ToolCallCard";
import { BookIcon, DocIcon, CloseIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ShieldCheck } from "lucide-react";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";

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
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function AiChatComposer({
  input, onInputChange, onPaste, onSend, streaming, onStop,
  attachment, onRemoveAttachment, showAttachment, onToggleShowAttachment,
  showTools, onToggleTools, enabledGroups, onToggleGroup,
  tokenCount, textareaRef,
}: Props) {
  const t = useT();
  const narrow = useIsNarrow();

  return (
    <div className="shrink-0 bg-background/75 px-2 py-2 backdrop-blur-xl lg:py-3">
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

      {/* One row at every width — input, tools, send. A composer that rests
        * three lines tall is wasted screen on a phone and dead space on a
        * desktop; it grows only as the message does (the autosize effect in
        * useChatComposer). Only the labels differ by width. */}
      <div className="flex items-end gap-1 rounded-[22px] border border-border/70 bg-card/95 p-1.5 shadow-[0_14px_45px_-28px_rgba(0,0,0,.55)] transition-colors focus-within:border-primary/30 lg:gap-2 lg:p-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onPaste={onPaste}
          // Stays editable while the answer streams — you can line up the next
          // message instead of waiting. Enter is swallowed until the turn
          // finishes (sendMessage would refuse it anyway).
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!streaming) onSend(); } }}
          // The long form wraps to three lines on a phone, so the resting
          // composer reads as a wall of grey placeholder rather than an input.
          placeholder={
            enabledGroups.size === 0 ? t("aichat.placeholderPlain")
              : narrow ? t("aichat.placeholderShort")
              : t("aichat.placeholder")
          }
          rows={1}
          className="block max-h-[240px] min-h-8 w-full min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-[16px] leading-6 placeholder:text-muted-foreground/35 focus:outline-hidden lg:text-sm"
        />

        <div className="flex shrink-0 items-center gap-1 lg:gap-2">
        <Popover open={showTools} onOpenChange={() => onToggleTools()}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              title={t("aichat.accessTitle")}
              aria-label={t("aichat.accessTitle")}
              className={`relative h-8 rounded-xl text-[11px] font-medium transition-colors ${
                narrow ? "w-8 shrink-0 p-0" : "gap-1.5 px-2.5"
              } ${
                enabledGroups.size > 0
                  ? "bg-primary/8 text-primary hover:bg-primary/12"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {!narrow && <span>{t("aichat.accessButton")}</span>}
              {enabledGroups.size > 0 && (
                narrow
                  // No room for a label, so the count rides the icon as a badge —
                  // otherwise "tools are on" is invisible at this size.
                  ? <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-[8px] font-bold text-primary-foreground">{enabledGroups.size}</span>
                  : <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary/10 px-1 text-[9px] font-bold">{enabledGroups.size}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" sideOffset={8} className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-border/70 bg-card p-0 shadow-2xl">
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
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{t(`aichat.access.${g}.title`)}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{t(`aichat.access.${g}.description`)}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {TOOL_GROUPS[g].tools.map((toolName) => (
                        <span key={toolName} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/80">
                          {TOOL_LABELS[toolName] ?? toolName}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${active ? "bg-primary" : "bg-muted-foreground/25"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${active ? "translate-x-[18px]" : "translate-x-0.5"}`} /></span>
                </button>
              );
            })}
            </div>
            <div className="border-t border-border/60 bg-muted/20 px-4 py-2.5"><p className="text-[9px] leading-4 text-muted-foreground">{enabledGroups.size === 0 ? t("aichat.accessNone") : t("aichat.accessHint")}</p></div>
          </PopoverContent>
        </Popover>

        {streaming ? (
          <Button
            variant="ghost"
            onClick={onStop}
            title={t("aichat.stop")}
            aria-label={t("aichat.stop")}
            className={`h-8 shrink-0 rounded-xl bg-destructive/10 text-xs font-semibold text-destructive hover:bg-destructive/15 ${
              narrow ? "w-8 p-0" : "gap-2 px-3"
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-[2px] bg-destructive" />
            {!narrow && t("aichat.stop")}
          </Button>
        ) : (
          <Button
            onClick={onSend}
            disabled={!input.trim() && !attachment}
            title={t("aichat.send")}
            aria-label={t("aichat.send")}
            className={`h-8 shrink-0 rounded-xl text-xs font-semibold shadow-xs shadow-primary/20 disabled:shadow-none ${
              narrow ? "w-8 p-0" : "gap-1.5 px-3.5"
            }`}
          >
            {!narrow && t("aichat.send")}
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 1.5l13 6.5-13 6.5V9.5l9-3-9-3V1.5z" /></svg>
          </Button>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
