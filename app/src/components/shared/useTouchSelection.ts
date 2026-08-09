import { useCallback, useEffect, useMemo, useState } from "react";
import { IGNORED } from "./selectionAskHelpers";
import { NOT_SELECTABLE, TAP_TO_FOLLOW, isTouchHost, rangeBetween, sameRange, wordRangeAt } from "./touchSelection";

/** Long enough not to fire on a tap or the start of a flick-scroll, short
 *  enough that it still feels like a press rather than a wait. */
const LONG_PRESS_MS = 380;
/** Past this the finger is scrolling, not pressing. */
const MOVE_TOLERANCE = 10;

interface TouchSelection {
  range: Range | null;
  /** True mid-drag, so the toolbar can stay out of the way until the finger
   *  lifts instead of chasing it across the paragraph. */
  dragging: boolean;
}

const EMPTY: TouchSelection = { range: null, dragging: false };

/**
 * Owns text selection on touch devices, replacing the browser's.
 *
 * The gesture grammar is the one people already know from e-readers:
 *   tap a word        → select it (tap it again, or tap blank space, to drop it)
 *   long press + drag → grow the selection out to a phrase or sentence
 *
 * While this is active the document carries `data-touch-select`, which turns
 * native selection off everywhere but form fields — that, and never touching
 * `window.getSelection()`, is what keeps the OS Copy/Translate bar away.
 */
export function useTouchSelection(enabled: boolean) {
  const active = useMemo(() => enabled && isTouchHost(), [enabled]);
  const [selection, setSelection] = useState<TouchSelection>(EMPTY);
  const clear = useCallback(() => setSelection((prev) => (prev.range ? EMPTY : prev)), []);

  useEffect(() => {
    if (!active) return;
    document.documentElement.setAttribute("data-touch-select", "");

    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let pivot: Range | null = null;
    let dragging = false;
    let moved = false;
    let blocked = false;
    let onLink = false;
    let swallowClicksUntil = 0;

    const cancelTimer = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    // Only a drag needs to cancel scrolling, and a permanently non-passive
    // touchmove listener costs the whole app its fast scroll path — so this
    // one is attached for the length of the gesture and taken straight off.
    const onDragMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || !pivot) return;
      e.preventDefault();
      setSelection({ range: rangeBetween(pivot, touch.clientX, touch.clientY), dragging: true });
    };

    const reset = () => {
      cancelTimer();
      document.removeEventListener("touchmove", onDragMove, true);
      start = null;
      pivot = null;
      dragging = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return reset();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      // Our own toolbar, form fields and controls keep their normal behaviour
      // — and a tap on them must not be read as "dismiss the selection".
      blocked = !el || !!el.closest(IGNORED) || !!el.closest(NOT_SELECTABLE);
      if (blocked) return;
      // Inline links stay tappable — articles are full of them, and a link
      // that couldn't be followed would be worse than one that can't be
      // tap-selected. A long press on one still selects, like anywhere else.
      onLink = !!el?.closest(TAP_TO_FOLLOW);
      start = { x: touch.clientX, y: touch.clientY };
      moved = false;
      cancelTimer();
      timer = window.setTimeout(() => {
        timer = 0;
        const word = start && wordRangeAt(start.x, start.y);
        if (!word) return;
        pivot = word;
        dragging = true;
        document.addEventListener("touchmove", onDragMove, { capture: true, passive: false });
        setSelection({ range: word, dragging: true });
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || !start || dragging) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE) {
        moved = true;
        cancelTimer();
      }
    };

    const onTouchEnd = () => {
      cancelTimer();
      if (dragging) {
        setSelection((prev) => ({ ...prev, dragging: false }));
        // A press that ends where it began still produces a click; without
        // this, long-pressing a link to select it would also follow it.
        swallowClicksUntil = Date.now() + 400;
        reset();
        return;
      }
      const point = start;
      reset();
      if (blocked || onLink || moved || !point) return;
      const word = wordRangeAt(point.x, point.y);
      setSelection((prev) => {
        // Tapping blank space, or the word that's already selected, clears —
        // that's the only way out now that there's no native selection to lose.
        if (!word) return prev.range ? EMPTY : prev;
        if (prev.range && sameRange(prev.range, word)) return EMPTY;
        return { range: word, dragging: false };
      });
    };

    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (Date.now() > swallowClicksUntil || el?.closest?.(IGNORED)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Android fires a context menu off the same long press we just claimed.
    const onContextMenu = (e: Event) => {
      const el = e.target as Element | null;
      if (!el?.closest?.(IGNORED)) e.preventDefault();
    };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    document.addEventListener("touchcancel", reset, { capture: true, passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      reset();
      document.documentElement.removeAttribute("data-touch-select");
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", reset, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [active]);

  return { active, range: selection.range, dragging: selection.dragging, clear };
}
