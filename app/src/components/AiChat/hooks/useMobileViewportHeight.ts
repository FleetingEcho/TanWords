import { useMobileVisualViewport } from "@/hooks/useMobileVisualViewport";

/** Below-lg page height driven by the *visual* viewport instead of the layout
 *  viewport. On iOS/Android the on-screen keyboard resizes the visual viewport
 *  while the layout one (what `h-full`/`100dvh` measure) stays put — so a
 *  composer pinned to the page bottom ends up hidden behind the keyboard
 *  unless the page shrinks with `visualViewport.height`.
 *
 *  Thin wrapper over the shared `useMobileVisualViewport` module (which also
 *  exposes `offsetTop` and keyboard detection for the shell). Returns `null`
 *  on ≥lg viewports or where `visualViewport` is missing, so callers can fall
 *  back to their ordinary `h-full` and desktop layout is completely
 *  untouched. */
export function useMobileViewportHeight(): number | null {
  return useMobileVisualViewport().height;
}
