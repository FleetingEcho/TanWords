import { useCallback, useRef, useState } from "react";
import { normalizeAddress } from "./useBrowserPanel";
import type { BrowserTab } from "./useBrowserPanel";

/** Web-mode Browser page: an `<iframe>`-based stand-in for the desktop's
 *  native `WebContentsView`.
 *
 *  The native panel can't exist in the web build (no Electron main process),
 *  so the Browser page falls back to iframes here. The tradeoff is inherent to
 *  the web platform: many sites send `X-Frame-Options`/`frame-ancestors` and
 *  will refuse to embed (the iframe goes blank — the "Open in default browser"
 *  button is the escape hatch), and the app cannot intercept cross-origin
 *  iframe requests, so the ad-block shield is desktop-only.
 *
 *  Cross-origin iframes also hide their `location` and `document.title` from the
 *  parent, so the address bar tracks only what the user typed and back/forward
 *  navigate the typed-URL stack (not in-page link clicks). That matches the
 *  honesty of every "mini browser in a page" implementation. */
export interface WebBrowserTab extends BrowserTab {
  /** Typed-URL history stack, navigated by back/forward. In-page link clicks
   *  inside the iframe are invisible to the parent, so they don't push here. */
  hist: string[];
  hi: number;
  /** Bumped to force an iframe remount (= reload). Setting `src` to the same
   *  value doesn't reload; `cross-origin iframe.contentWindow.location.reload()`
   *  throws, so remounting via `key` is the reliable reload. */
  reloadSeq: number;
}

let keySeq = 0;
const freshTab = (): WebBrowserTab => ({
  key: `web-${++keySeq}`,
  url: "",
  title: "",
  loading: false,
  atHome: true,
  panelId: null,
  preview: null,
  hist: [],
  hi: -1,
  reloadSeq: 0,
});

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function useWebBrowser() {
  const [tabs, setTabs] = useState<WebBrowserTab[]>(() => [freshTab()]);
  const [activeKey, setActiveKey] = useState<string>(() => tabs[0].key);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const open = useCallback((raw: string) => {
    const target = normalizeAddress(raw);
    if (!target) return;
    const key = activeKeyRef.current;
    setTabs((prev) => prev.map((t) => {
      if (t.key !== key) return t;
      const hist = [...t.hist.slice(0, t.hi + 1), target];
      return { ...t, url: target, atHome: false, loading: true, title: hostOf(target), hist, hi: hist.length - 1 };
    }));
  }, []);

  const goBack = useCallback(() => {
    const key = activeKeyRef.current;
    setTabs((prev) => prev.map((t) => {
      if (t.key !== key || t.hi <= 0) return t;
      const hi = t.hi - 1;
      const url = t.hist[hi];
      return { ...t, hi, url, atHome: false, loading: true, title: hostOf(url) };
    }));
  }, []);

  const goForward = useCallback(() => {
    const key = activeKeyRef.current;
    setTabs((prev) => prev.map((t) => {
      if (t.key !== key || t.hi >= t.hist.length - 1) return t;
      const hi = t.hi + 1;
      const url = t.hist[hi];
      return { ...t, hi, url, atHome: false, loading: true, title: hostOf(url) };
    }));
  }, []);

  const reload = useCallback(() => {
    const key = activeKeyRef.current;
    setTabs((prev) => prev.map((t) =>
      t.key === key && t.url ? { ...t, reloadSeq: t.reloadSeq + 1, loading: true } : t));
  }, []);

  const goHome = useCallback(() => {
    const key = activeKeyRef.current;
    // Keep `url` so the iframe stays mounted (hidden) — the page's scroll/form
    // state survives a trip home and back. The address bar clears via atHome.
    setTabs((prev) => prev.map((t) => t.key === key ? { ...t, atHome: true, loading: false } : t));
  }, []);

  const newTab = useCallback(() => {
    const tab = freshTab();
    setTabs((prev) => [...prev, tab]);
    setActiveKey(tab.key);
  }, []);

  const selectTab = useCallback((key: string) => setActiveKey(key), []);

  const closeTab = useCallback((key: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.key === key);
      if (index === -1) return prev;
      const rest = prev.filter((t) => t.key !== key);
      const next = rest.length ? rest : [freshTab()];
      if (key === activeKeyRef.current) {
        setActiveKey(next[Math.min(index, next.length - 1)].key);
      }
      return next;
    });
  }, []);

  /** Called by the iframe's onLoad — cross-origin iframes can't report a
   *  title or in-page navigation, so this just clears the loading spinner. */
  const markLoaded = useCallback((key: string) => {
    setTabs((prev) => prev.map((t) => t.key === key ? { ...t, loading: false } : t));
  }, []);

  // On web, "clear data" is a no-op — iframe cookies live in the host
  // browser's jar for those origins and can't be selectively cleared. The
  // toolbar hides the button on web, so this only exists to satisfy the
  // shared surface.
  const clearData = useCallback(async () => {}, []);

  return {
    tabs,
    active,
    activeKey,
    error: null as string | null,
    open,
    reload,
    goBack,
    goForward,
    goHome,
    clearData,
    newTab,
    selectTab,
    closeTab,
    markLoaded,
  };
}
