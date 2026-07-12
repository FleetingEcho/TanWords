import React from "react";
import { useT } from "@/hooks/useT";
import { PatternSlots, TagChip } from "@/components/Patterns/PatternDetailPanel";
import type { PatternDetail } from "@/hooks/useDB.types";

interface Props {
  pattern: PatternDetail;
  position: { top: number; left: number };
  onAddExample: (sentence: string) => void;
  onViewPattern: () => void;
  onClose: () => void;
  sentence: string;
}

export function ReencounterPopover({
  pattern,
  position,
  onAddExample,
  onViewPattern,
  onClose,
  sentence,
}: Props) {
  const t = useT();

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Popover */}
      <div
        className="fixed z-50 w-72 bg-card border border-border rounded-xl shadow-lg p-4 animate-fade-in"
        style={{
          top: Math.min(position.top, window.innerHeight - 280),
          left: Math.min(position.left, window.innerWidth - 320),
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {t("patterns.reencounter")}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="mb-2">
          <PatternSlots text={pattern.pattern} />
        </div>

        {pattern.zh && (
          <p className="text-xs text-muted-foreground mb-2">{pattern.zh}</p>
        )}

        {pattern.function_tag && (
          <div className="mb-3">
            <TagChip tag={pattern.function_tag} />
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onAddExample(sentence)}
            className="flex-1 h-8 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("patterns.addAsExample")}
          </button>
          <button
            onClick={onViewPattern}
            className="flex-1 h-8 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
          >
            {t("patterns.viewPattern")}
          </button>
        </div>
      </div>
    </>
  );
}
