import React from "react";
import { useT } from "@/hooks/useT";
import { SpeakerIcon } from "@/components/ui/icons";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { Button } from "@/components/ui/button";

/** Stable per-text key, so clicking the same word twice resumes/stops the same
 *  playback instead of starting a second one — and so the synthesis cache in
 *  `useArticlePlayer`, which is scoped to a sourceKey, survives a repeat click. */
const sourceKeyFor = (text: string) => `speak:${text}`;

/** Small inline speaker button for a single word/sentence — used anywhere a
 * piece of English text is shown (word lists, examples, idioms, patterns).
 *
 * It owns no audio of its own. Pressing it hands the text to `ttsPlayerStore`,
 * the same player the reader uses, which means a long selection is split into
 * sentences and synthesized a couple ahead rather than in one slow blocking
 * call — and that it keeps playing, controllable from the top bar, after
 * whatever surfaced this button (a selection toolbar, a popover) has closed.
 *
 * The podcast/music player is separate and untouched; the two only ever
 * interact through `audioChannel`, which stops one when the other starts. */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const status = useTtsPlayerStore((s) => s.status);
  const sourceKey = useTtsPlayerStore((s) => s.sourceKey);
  const start = useTtsPlayerStore((s) => s.start);
  const stop = useTtsPlayerStore((s) => s.stop);

  const trimmed = text.trim();
  const mine = sourceKey === sourceKeyFor(trimmed) && status !== "idle";
  const active = mine && (status === "playing" || status === "loading");

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trimmed) return;
    // Pressing the speaker that is already speaking means "stop", not
    // "pause" — the button is a toggle with no transport of its own; the top
    // bar is where pause/skip live.
    if (mine) {
      stop();
      return;
    }
    start(sourceKeyFor(trimmed), trimmed);
  };

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
      // Not disabled while synthesizing: a long selection takes a moment, and
      // the press that cancels it has to land on the button that started it.
      title={t("tts.preview")}
      className={`h-auto w-auto p-0 inline-flex items-center justify-center shrink-0 transition-colors hover:bg-transparent disabled:opacity-40 ${
        active ? "text-primary" : "text-muted-foreground hover:text-primary"
      } ${className ?? ""}`}
    >
      <SpeakerIcon className="w-full h-full" />
    </Button>
  );
}
