import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";
import { ParsedEnrichment } from "@/lib/enrichMeta";
import { EnrichmentText } from "@/components/EnrichmentText";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { LazyWordNotesEditor } from "@/components/LazyWordNotesEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { SparkIcon } from "@/components/ui/icons";
import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";

interface SelectedInfo {
  word: string;
  zh: string | null;
  wordType: string | null;
  level: string | null;
  ipa: string;
}

interface Props {
  selected: SelectedInfo;
  wordId: number | null;
  enriched: ParsedEnrichment | null;
  enriching: boolean;
  enrichError: string;
  /** True when this word only has old structured enrichment (pre-rewrite) — offer regenerate instead of rendering it. */
  legacy: boolean;
  notes: string;
  vocabBilingual: boolean;
  /** Dictionary lookup of a word not (yet) in the vocabulary */
  lookupMode?: boolean;
  lookupAdded?: boolean;
  onAddToVocab?: () => void;
  onNotesChange: (v: string) => void;
  onClearNotes: () => void;
  onRetry: () => void;
  onReenrich: () => void;
}

export function WordDetailPanel({
  selected, wordId, enriched, enriching, enrichError, legacy, notes, vocabBilingual,
  lookupMode = false, lookupAdded = false, onAddToVocab,
  onNotesChange, onClearNotes, onRetry, onReenrich,
}: Props) {
  const t = useT();
  const openWordModal = useWordModalStore((s) => s.openWordModal);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Enriching banner */}
      {enriching && (
        <div className="flex items-center gap-2 px-6 pt-4 pb-0">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-xs text-muted-foreground">{t("vocab.analyzing")}</span>
        </div>
      )}
      {!enriching && enrichError && !enriched && (
        <div className="flex items-center gap-2 px-6 pt-4 pb-0">
          <span className="text-xs text-destructive inline-flex items-center gap-1"><ExclamationTriangleIcon className="w-3.5 h-3.5" /> {enrichError}</span>
          <button onClick={onRetry} className="text-xs text-primary hover:underline">{t("vocab.retry")}</button>
        </div>
      )}

      <div className="p-6 space-y-5 animate-fade-in max-w-3xl">
        {/* Word header */}
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{selected.word}</h1>
            {selected.ipa && <span className="text-muted-foreground text-sm font-mono">/{selected.ipa}/</span>}
            <SpeakButton text={selected.word} className="w-4 h-4" />
            <LevelBadge level={selected.level} />
            {selected.wordType && (
              <span className="text-xs font-medium text-muted-foreground border border-border px-2 py-0.5 rounded">{selected.wordType}</span>
            )}
            <div className="ml-auto flex items-center gap-3">
              {lookupMode ? (
                <button
                  onClick={onAddToVocab}
                  disabled={lookupAdded || enriching || !enriched}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    lookupAdded
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  }`}
                >
                  {lookupAdded ? t("search.added") : t("search.addToVocab")}
                </button>
              ) : (
                <>
                  {enriched && !enriching && (
                    <button onClick={onReenrich} className="text-xs text-muted-foreground hover:text-primary transition-colors">{t("vocab.reenrich")}</button>
                  )}
                  <button onClick={() => openWordModal(selected.word)} className="text-xs font-medium text-primary hover:underline">{t("vocab.aiDetail")}</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Legacy structured enrichment from before the freeform-text rewrite */}
        {!lookupMode && legacy && !enriching && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 text-xs">
            <span className="text-amber-600 dark:text-amber-400">{t("vocab.legacyEnrichment")}</span>
            <button onClick={onReenrich} className="font-semibold text-primary hover:underline inline-flex items-center gap-1">
              <SparkIcon className="w-3 h-3" /> {t("vocab.reenrich")}
            </button>
          </div>
        )}

        {enriched && !legacy && <EnrichmentText text={enriched.text} />}

        {/* My Notes (only for saved words) */}
        {!lookupMode && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("vocab.myNotes")}</p>
            {notes && (
              <button onClick={() => setConfirmClearOpen(true)} className="text-[11px] text-muted-foreground hover:text-destructive transition-colors">{t("vocab.clear")}</button>
            )}
          </div>
          <div className="rounded-xl border border-border bg-muted/20 h-40">
            <LazyWordNotesEditor wordId={wordId} text={notes} onChange={onNotesChange} />
          </div>
          <ConfirmModal
            open={confirmClearOpen}
            title={t("vocab.clearNotesTitle")}
            message={t("vocab.clearNotesMessage")}
            confirmLabel={t("vocab.clear")}
            onConfirm={() => { onClearNotes(); setConfirmClearOpen(false); }}
            onCancel={() => setConfirmClearOpen(false)}
          />
        </section>
        )}

        {/* Enrich error */}
        {!enriched && !enriching && enrichError && (
          <div className="py-4 text-center space-y-2">
            <p className="text-sm text-destructive inline-flex items-center gap-1.5"><ExclamationTriangleIcon className="w-4 h-4" /> {enrichError}</p>
            <button onClick={onRetry} className="text-xs font-semibold text-primary hover:underline">{t("vocab.retry")}</button>
          </div>
        )}

        {/* No enrichment, no error, not enriching */}
        {!enriched && !legacy && !enriching && !enrichError && (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground mb-2">{t("vocab.noData")}</p>
            <button onClick={onRetry} className="text-xs font-semibold text-primary hover:underline">{t("vocab.aiEnrich")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
