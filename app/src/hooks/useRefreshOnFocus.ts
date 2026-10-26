import { useEffect, useRef } from "react";

/** Re-run `onRefresh` when this window regains focus or becomes visible
 * again.
 *
 * Library pages (Words / Sentences) already reload on in-window
 * `vocab-updated` / `sentences-updated` CustomEvents, but a dispatchEvent
 * only reaches the document that raised it — adds made in a sibling window
 * (floating browser, sticky windows) or outside the app entirely (shared
 * database, MCP traffic) leave the open page stale until a manual refresh.
 * Focus/visibility is the one moment every one of those changes has already
 * landed AND the user is looking at the page again, so it doubles as a
 * catch-all resync point. Bursts (blur → refocus, devtools open/close) fire
 * focus repeatedly, so refreshes collapse to at most one per 2s. */
export function useRefreshOnFocus(onRefresh: () => void) {
  const lastRefreshAt = useRef(0);
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt.current < 2000) return;
      lastRefreshAt.current = now;
      onRefresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onRefresh]);
}
