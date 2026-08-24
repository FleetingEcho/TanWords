import { useEffect } from "react";
import { useBrowserPanelBlockStore } from "@/store/browserPanelStore";
import { useDshPanelBlockStore } from "@/store/dshPanelBlockStore";

/** Bridges a workspace pane's visibility to the native panel block stores.
 *
 *  Browser and DSH pages drive native child views (`WebContentsView`) that
 *  composite *above* all of our HTML — no `z-index` can put another pane's
 *  content in front of them. When a native page is hosted in a pane that is
 *  not the visible pane (a sibling is focused, or the pane scrolled out of
 *  view), the native surface must step aside, exactly the way it does for a
 *  modal overlay (`browserPanelStore`/`dshPanelBlockStore`).
 *
 *  The page stays mounted (it is retained, so its state survives), but its
 *  native view hides while `visible` is false. This reuses the existing
 *  hide/show mechanism the browser and DSH hooks already read, so no page
 *  code changes — the pane just toggles the same counter a modal would.
 *
 *  Both pages are singletons (at most one instance across all workspaces), so
 *  a single global hide signal is correct: there is never a second native pane
 *  that should stay visible while the first is hidden. */
export function usePaneNativeVisibility(pageId: string, visible: boolean) {
  const blockBrowser = useBrowserPanelBlockStore((s) => s.block);
  const unblockBrowser = useBrowserPanelBlockStore((s) => s.unblock);
  const blockDsh = useDshPanelBlockStore((s) => s.block);
  const unblockDsh = useDshPanelBlockStore((s) => s.unblock);

  useEffect(() => {
    if (visible) return;
    // Only native pages composite above the HTML; ordinary React pages just
    // clip behind the focused pane with no native surface to hide.
    if (pageId !== "browser" && pageId !== "dsh") return;
    if (pageId === "browser") { blockBrowser(); return unblockBrowser; }
    if (pageId === "dsh") { blockDsh(); return unblockDsh; }
  }, [pageId, visible, blockBrowser, unblockBrowser, blockDsh, unblockDsh]);
}
