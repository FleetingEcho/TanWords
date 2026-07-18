export type PlayMode = "order" | "loop-one" | "loop-all" | "shuffle";

export const PLAY_MODES: PlayMode[] = ["order", "loop-one", "loop-all", "shuffle"];

/** Index to play after the current track ENDS on its own, or null to stop.
 * `rand` is injectable for tests (defaults to Math.random). */
export function nextIndexOnEnded(
  current: number,
  length: number,
  mode: PlayMode,
  rand: () => number = Math.random
): number | null {
  if (length <= 0) return null;
  switch (mode) {
    case "order":
      return current + 1 < length ? current + 1 : null;
    case "loop-one":
      return current;
    case "loop-all":
      return (current + 1) % length;
    case "shuffle":
      return shuffledIndex(current, length, rand);
  }
}

/** Index for an explicit next/prev click. Unlike nextIndexOnEnded, "loop-one"
 * still advances — clicking next while repeating a track should move on. */
export function nextIndexOnSkip(
  current: number,
  length: number,
  mode: PlayMode,
  direction: 1 | -1,
  rand: () => number = Math.random
): number | null {
  if (length <= 0) return null;
  if (mode === "shuffle") return shuffledIndex(current, length, rand);
  return (current + direction + length) % length;
}

function shuffledIndex(current: number, length: number, rand: () => number): number {
  if (length === 1) return current;
  // Draw from the other length-1 slots so shuffle never repeats the same track.
  const i = Math.floor(rand() * (length - 1));
  return i >= current ? i + 1 : i;
}
