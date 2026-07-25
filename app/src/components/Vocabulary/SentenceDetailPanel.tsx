import React from "react";
import { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

interface Props {
  selected: PatternItem | null;
  onRequestDelete: () => void;
}

/** Sentence detail — mirrors WordDetailPanel's layout (big heading, level +
 *  speak inline, translation, note box). The heading is the actual saved
 *  sentence, not the reusable pattern skeleton (e.g. "stifle + discussion/
 *  dialogue/communication") — that skeleton is shown underneath as a small
 *  mono tag since it's metadata about the sentence, not the sentence itself. */
export function SentenceDetailPanel({ selected, onRequestDelete }: Props) {
  const t = useT();

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{t("vocab.patterns.selectPrompt")}</p>
      </div>
    );
  }

  const [primary, ...rest] = selected.examples;
  const sentence = primary?.sentence ?? selected.pattern;
  const showSkeleton = selected.pattern && selected.pattern !== sentence;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="p-6 space-y-5 animate-fade-in w-full">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold break-words">{sentence}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <LevelBadge level={selected.level} />
              <SpeakButton text={sentence} className="w-4 h-4" />
              {primary?.source && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{primary.source}</span>
              )}
            </div>
            {selected.zh && <p className="mt-2 text-sm text-muted-foreground">{selected.zh}</p>}
            {showSkeleton && <p className="mt-2 text-xs font-mono text-muted-foreground/70">{selected.pattern}</p>}
          </div>
          <Button
            variant="ghost"
            onClick={onRequestDelete}
            title={t("vocab.patterns.delete")}
            className="w-7 h-7 p-0 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors shrink-0"
          >
            <TrashIcon className="w-4 h-4" />
          </Button>
        </div>

        {selected.note && !selected.note.startsWith("__") && (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm leading-6">{selected.note}</p>
        )}

        {rest.length > 0 && (
          <section>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("vocab.patterns.moreExamples")}
            </p>
            <div className="space-y-2.5">
              {rest.map((example) => (
                <div key={example.id} className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                  <SpeakButton text={example.sentence} className="mt-0.5 w-3.5 h-3.5 shrink-0" />
                  <p className="min-w-0 flex-1 break-words text-sm leading-6">{example.sentence}</p>
                  {example.source && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{example.source}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
