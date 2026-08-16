import { useEffect } from "react";
import { create } from "zustand";

/** Tracks how many DOM overlays are currently on screen that the native DSH
 *  panel must not cover.
 *
 *  Mirror of `browserPanelStore`: the DSH page's panel is a real child
 *  `WebContentsView` layered over the window, composited *above* all of our
 *  HTML, so no `z-index` can put a modal in front of it. The only way for an
 *  overlay (the DSH failed-to-start modal, any app-wide dialog) to be visible
 *  over the DSH page is for the panel to hide itself while that overlay is up.
 *
 *  A counter, not a boolean, so nested/stacked overlays release correctly. */
interface DshPanelBlockState {
  blockers: number;
  block: () => void;
  unblock: () => void;
}

export const useDshPanelBlockStore = create<DshPanelBlockState>((set) => ({
  blockers: 0,
  block: () => set((s) => ({ blockers: s.blockers + 1 })),
  unblock: () => set((s) => ({ blockers: Math.max(0, s.blockers - 1) })),
}));

/** Call from any overlay that renders over page content while the DSH panel
 *  might be visible. Mount the component only while the overlay is open (Radix
 *  `Content` inside a `Portal` already works this way) and the panel hides and
 *  restores itself automatically. */
export function useBlockDshPanel() {
  useEffect(() => {
    const { block, unblock } = useDshPanelBlockStore.getState();
    block();
    return unblock;
  }, []);
}

/** Renderless version, for wrapping a Radix `Content` without turning it into
 *  a new component just to hold a hook. Drop-in sibling of
 *  `BrowserPanelBlocker` — both are mounted inside the shared `Dialog` so any
 *  modal in the app steps aside for whichever native panel happens to be up. */
export function DshPanelBlocker() {
  useBlockDshPanel();
  return null;
}
