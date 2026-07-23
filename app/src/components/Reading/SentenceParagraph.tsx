import React from "react";

export interface ParagraphSentence {
  text: string;
  /** Index into the whole article's sentence list — how the TTS player
   * addresses this exact sentence for highlighting/click-to-jump. */
  globalIndex: number;
}

/**
 * A paragraph of plain article text. When the article player is active, the
 * currently-playing sentence is highlighted and clicking a sentence jumps
 * playback there.
 */
export function SentenceParagraph({
  sentences,
  playerActive,
  playerCurrentIndex,
  onPlayerJump,
  registerSpanRef,
}: {
  sentences: ParagraphSentence[];
  playerActive: boolean;
  playerCurrentIndex: number;
  onPlayerJump: (globalIndex: number) => void;
  registerSpanRef: (globalIndex: number, el: HTMLSpanElement | null) => void;
}) {
  return (
    <p className="text-sm leading-[1.9] text-foreground">
      {sentences.map(({ text, globalIndex }) => {
        const isPlayerCurrent = playerActive && playerCurrentIndex === globalIndex;

        return (
          <span
            key={globalIndex}
            ref={(el) => registerSpanRef(globalIndex, el)}
            data-si={globalIndex}
            onClick={() => {
              if (playerActive) onPlayerJump(globalIndex);
            }}
            className={`rounded-sm box-decoration-clone transition-colors ${
              isPlayerCurrent
                ? "bg-primary/15 cursor-pointer"
                : playerActive
                ? "cursor-pointer hover:bg-muted/70"
                : ""
            }`}
          >
            {text}
          </span>
        );
      })}
    </p>
  );
}
