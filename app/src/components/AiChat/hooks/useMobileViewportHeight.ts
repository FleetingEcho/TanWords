import { useEffect, useState } from "react";

/** Below-lg page height driven by the *visual* viewport instead of the layout
 *  viewport. On iOS/Android the on-screen keyboard resizes the visual viewport
 *  while the layout one (what `h-full`/`100dvh` measure) stays put — so a
 *  composer pinned to the page bottom ends up hidden behind the keyboard
 *  unless the page shrinks with `visualViewport.height`.
 *
 *  Returns `null` on ≥lg viewports or where `visualViewport` is missing, so
 *  callers can fall back to their ordinary `h-full` and desktop layout is
 *  completely untouched. */
export function useMobileViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(mq.matches ? vv.height : null);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    mq.addEventListener("change", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      mq.removeEventListener("change", update);
    };
  }, []);

  return height;
}
