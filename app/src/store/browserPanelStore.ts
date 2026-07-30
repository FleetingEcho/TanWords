import { useEffect } from "react";
import { create } from "zustand";

/** Tracks how many DOM overlays are currently on screen that the native
 *  browser panel must not cover.
 *
 *  The Browser page's panel is a real child `WKWebView` layered over the
 *  window, not an element in this document — it is composited *above* all of
 *  our HTML, so no `z-index` can put a modal in front of it. The only way for
 *  an overlay to be visible over the Browser page is for the panel to hide
 *  itself while that overlay is up.
 *
 *  Deliberately a registry rather than something that sniffs the DOM for
 *  fixed-position elements: overlays in this app are heterogeneous (Radix
 *  portals, hand-rolled `fixed inset-0` divs, a draggable tool window), and a
 *  detector would be guessing at which of them actually matter. It also has
 *  to *not* fire for things like the app background (fixed, but behind
 *  everything) or toasts (transient — blanking the page for four seconds
 *  would be worse than the overlap).
 *
 *  A counter, not a boolean, so nested/stacked overlays release correctly. */
interface BrowserPanelBlockState {
  blockers: number;
  block: () => void;
  unblock: () => void;
}

export const useBrowserPanelBlockStore = create<BrowserPanelBlockState>((set) => ({
  blockers: 0,
  block: () => set((s) => ({ blockers: s.blockers + 1 })),
  unblock: () => set((s) => ({ blockers: Math.max(0, s.blockers - 1) })),
}));

/** Call from any overlay that renders over page content. Mount the component
 *  only while the overlay is open (Radix `Content` inside a `Portal` already
 *  works this way) and the panel hides and restores itself automatically. */
export function useBlockBrowserPanel() {
  useEffect(() => {
    const { block, unblock } = useBrowserPanelBlockStore.getState();
    block();
    return unblock;
  }, []);
}

/** Renderless version, for wrapping a Radix `Content` without turning it into
 *  a new component just to hold a hook. */
export function BrowserPanelBlocker() {
  useBlockBrowserPanel();
  return null;
}
