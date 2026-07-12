import React from "react";
import { ExtractedItem } from "@/hooks/useDB";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight extracted items inside one sentence; item clicks jump to their card. */
function renderHighlights(
  text: string,
  items: ExtractedItem[],
  onJump: (id: number) => void
): React.ReactNode[] {
  const active = items.filter((it) => it.status !== "dismissed" && it.text.trim());
  if (active.length === 0) return [text];
  const sorted = [...active].sort((a, b) => b.text.length - a.text.length);
  const pattern = sorted
    .map((it) => {
      const esc = escapeRegExp(it.text.trim());
      return it.kind === "word" ? `\\b${esc}\\b` : esc;
    })
    .join("|");
  let re: RegExp;
  try {
    re = new RegExp(`(${pattern})`, "gi");
  } catch {
    return [text];
  }
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const match = sorted.find(
      (it) =>
        it.text.trim().toLowerCase() === part.trim().toLowerCase() ||
        part.toLowerCase().includes(it.text.trim().toLowerCase())
    );
    if (!match) return part;
    const isWord = match.kind === "word";
    return (
      <button
        key={i}
        onClick={(e) => {
          e.stopPropagation(); // don't also select the enclosing sentence
          onJump(match.id);
        }}
        className={`inline rounded-sm px-0.5 -mx-0.5 transition-colors cursor-pointer ${
          isWord
            ? "bg-primary/10 text-primary border-b border-primary/40 hover:bg-primary/20"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-b border-amber-500/40 hover:bg-amber-500/20"
        }`}
      >
        {part}
      </button>
    );
  });
}

export interface ParagraphSentence {
  text: string;
  /** Index into the whole article's sentence list — how the TTS player
   * addresses this exact sentence for highlighting/click-to-jump. */
  globalIndex: number;
}

/** Per-sentence re-encounter data pre-computed by the parent. */
export interface SentenceReencounter {
  /** Sentences whose globalIndex is in this set have library-pattern matches. */
  patternSentenceSet: Set<number>;
  /** For a given globalIndex, which pattern IDs matched. */
  patternMatches: Map<number, number[]>;
  /** Sentences whose globalIndex is in this set contain known vocabulary words. */
  wordSentenceSet: Set<number>;
}

/**
 * A paragraph where every sentence is clickable for close-reading, with
 * extracted words/patterns highlighted inside each sentence. When the
 * article player is active, the currently-playing sentence is highlighted
 * and clicking a sentence jumps playback there instead of opening the
 * analysis panel.
 */
export function SentenceParagraph({
  sentences,
  items,
  onJump,
  activeSentence,
  onSelectSentence,
  playerActive,
  playerCurrentIndex,
  onPlayerJump,
  registerSpanRef,
  reencounter,
  onReencounterPattern,
}: {
  sentences: ParagraphSentence[];
  items: ExtractedItem[];
  onJump: (id: number) => void;
  activeSentence: string | null;
  onSelectSentence: (sentence: string) => void;
  playerActive: boolean;
  playerCurrentIndex: number;
  onPlayerJump: (globalIndex: number) => void;
  registerSpanRef: (globalIndex: number, el: HTMLSpanElement | null) => void;
  reencounter?: SentenceReencounter;
  onReencounterPattern?: (patternId: number) => void;
}) {
  return (
    <p className="text-sm leading-[1.9] text-foreground">
      {sentences.map(({ text, globalIndex }) => {
        const trimmed = text.trim();
        const isPlayerCurrent = playerActive && playerCurrentIndex === globalIndex;
        const isSelected = !playerActive && activeSentence !== null && trimmed === activeSentence;
        const hasPatternReencounter = reencounter?.patternSentenceSet.has(globalIndex);
        const hasWordReencounter = reencounter?.wordSentenceSet.has(globalIndex);

        return (
          <span
            key={globalIndex}
            ref={(el) => registerSpanRef(globalIndex, el)}
            data-si={globalIndex}
            onClick={() => {
              if (playerActive) onPlayerJump(globalIndex);
              else if (trimmed) onSelectSentence(trimmed);
            }}
            className={`cursor-pointer rounded-sm box-decoration-clone transition-colors ${
              isPlayerCurrent
                ? "bg-primary/15"
                : isSelected
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : hasPatternReencounter
                    ? "border-b-2 border-amber-400/50 border-dotted"
                    : hasWordReencounter
                      ? "border-b-2 border-primary/30 border-dotted"
                      : "hover:bg-muted/70"
            }`}
          >
            {renderHighlights(text, items, onJump)}
            {/* Re-encounter pattern marker */}
            {hasPatternReencounter && onReencounterPattern && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const patternIds = reencounter?.patternMatches.get(globalIndex);
                  if (patternIds && patternIds.length > 0) {
                    onReencounterPattern(patternIds[0]);
                  }
                }}
                className="inline-flex items-center justify-center w-4 h-4 ml-0.5 rounded-full text-[10px] text-amber-600 bg-amber-100 hover:bg-amber-200 dark:text-amber-400 dark:bg-amber-900 transition-colors"
                title="Re-encounter: pattern in library"
              >
                ⟲
              </button>
            )}
          </span>
        );
      })}
    </p>
  );
}
