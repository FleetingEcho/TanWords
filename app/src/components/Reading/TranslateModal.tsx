import React from "react";
import { useT } from "@/hooks/useT";
import { TranslationPane } from "./TranslationPane";
import { CloseIcon, TranslateIcon } from "@/components/ui/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Plain article text to translate. */
  articleText: string;
  /** Set for Hacker News (or hnrss-style) entries — comments translate as their own section. */
  hnItemId?: number | null;
}

/** Popup wrapper around TranslationPane — see that component for how the actual
 *  translation (article + structured per-comment) works. Closing this only hides
 *  it; the AI call keeps running (translateStore isn't tied to this component's
 *  lifecycle) and reopening just re-shows whatever progress it's made. */
export function TranslateModal({ open, onClose, title, articleText, hnItemId }: Props) {
  const t = useT();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/45 px-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <TranslateIcon className="h-4 w-4 text-primary" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
          <button onClick={onClose} aria-label={t("reading.translate.close")} className="text-muted-foreground hover:text-foreground">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <TranslationPane articleText={articleText} hnItemId={hnItemId} />
      </div>
    </div>
  );
}
