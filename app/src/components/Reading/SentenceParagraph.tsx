import React from "react";
import { ExtractedItem } from "@/hooks/useDB";
import { Button } from "@/components/ui/button";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whitespace/case-insensitive form for matching an LLM-copied sentence back
 * to the splitter's sentence (quotes and spacing often differ slightly). */
function normalizeSentence(s: string): string {
  return s.replace(/[“”"'‘’]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Find the highlight-sentence item matching this sentence, if any. */
export function matchSentenceItem(text: string, sentenceItems: ExtractedItem[]): ExtractedItem | undefined {
  const norm = normalizeSentence(text);
  if (!norm) return undefined;
  return sentenceItems.find((it) => {
    const itNorm = normalizeSentence(it.text);
    if (!itNorm) return false;
    return itNorm === norm || itNorm.includes(norm) || norm.includes(itNorm);
  });
}

/** Highlight extracted words inside one sentence; clicks jump to their card. */
function renderHighlights(
  text: string,
  items: ExtractedItem[],
  onJump: (id: number) => void
): React.ReactNode[] {
  const active = items.filter((it) => it.status !== "dismissed" && it.text.trim());
  if (active.length === 0) return [text];
  const sorted = [...active].sort((a, b) => b.text.length - a.text.length);
  const pattern = sorted.map((it) => `\\b${escapeRegExp(it.text.trim())}\\b`).join("|");
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
    return (
      <Button
        key={i}
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onJump(match.id);
        }}
        className="h-auto inline rounded-sm px-0.5 -mx-0.5 transition-colors cursor-pointer bg-primary/10 text-primary border-b border-primary/40 hover:bg-primary/20"
      >
        {part}
      </Button>
    );
  });
}

export interface ParagraphSentence {
  text: string;
  /** Index into the whole article's sentence list — how the TTS player
   * addresses this exact sentence for highlighting/click-to-jump. */
  globalIndex: number;
}

/**
 * A paragraph where extracted words are highlighted inside each sentence.
 * When the article player is active, the currently-playing sentence is
 * highlighted and clicking a sentence jumps playback there.
 */
export function SentenceParagraph({
  sentences,
  items,
  sentenceItems = [],
  onJump,
  playerActive,
  playerCurrentIndex,
  onPlayerJump,
  registerSpanRef,
}: {
  sentences: ParagraphSentence[];
  items: ExtractedItem[];
  /** Highlight-sentence items (kind "sentence"); empty disables sentence highlighting. */
  sentenceItems?: ExtractedItem[];
  onJump: (id: number) => void;
  playerActive: boolean;
  playerCurrentIndex: number;
  onPlayerJump: (globalIndex: number) => void;
  registerSpanRef: (globalIndex: number, el: HTMLSpanElement | null) => void;
}) {
  return (
    <p className="text-sm leading-[1.9] text-foreground">
      {sentences.map(({ text, globalIndex }) => {
        const isPlayerCurrent = playerActive && playerCurrentIndex === globalIndex;
        const patternItem = sentenceItems.length ? matchSentenceItem(text, sentenceItems) : undefined;

        return (
          <span
            key={globalIndex}
            ref={(el) => registerSpanRef(globalIndex, el)}
            data-si={globalIndex}
            onClick={() => {
              if (playerActive) onPlayerJump(globalIndex);
              else if (patternItem) onJump(patternItem.id);
            }}
            title={patternItem && !playerActive ? patternItem.context_sentence || undefined : undefined}
            className={`rounded-sm box-decoration-clone transition-colors ${
              isPlayerCurrent
                ? "bg-primary/15 cursor-pointer"
                : playerActive
                ? "cursor-pointer hover:bg-muted/70"
                : patternItem
                ? "cursor-pointer bg-amber-200/40 dark:bg-amber-400/10 border-b border-amber-500/50 hover:bg-amber-200/70 dark:hover:bg-amber-400/20"
                : ""
            }`}
          >
            {renderHighlights(text, items, onJump)}
          </span>
        );
      })}
    </p>
  );
}
