import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface BrowserState {
  url: string;
  title: string;
  opened: boolean;
}

/** Turns any pasted text into something navigable: a bare domain gets a
 *  scheme, anything that isn't URL-shaped becomes a Google search — the
 *  same address-bar convention every browser uses. */
function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.includes(" ") && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Nudges WebKit into recompositing the page. Inserting the native child
 *  webview as a window-level sibling NSView, alongside this document's own
 *  GPU-promoted layers (anything with a CSS transition/transform, e.g. our
 *  toolbar buttons), can leave those layers blank — positioned correctly,
 *  just not repainted — until something else forces a recomposite. Toggling
 *  a transform on the root element is the standard nudge for this class of
 *  WebKit compositing bug. */
const forceRepaint = () => {
  const el = document.documentElement;
  const prev = el.style.transform;
  el.style.transform = "translateZ(0)";
  void el.offsetHeight;
  requestAnimationFrame(() => { el.style.transform = prev; });
};

/** Owns the native browser panel's lifecycle: opening/repositioning it under
 * a placeholder element, syncing address-bar state from Rust-side events
 * (in-page navigation, title, loading), and the nav/clear-data actions. The
 * panel itself outlives this hook's mounted lifetime (see browser_panel's
 * module doc) — `browser_get_state` on mount lets a remounted page pick up
 * wherever the still-alive panel actually is instead of resetting to empty.
 *
 * Every panel mutation is serialized through one queue and waits a couple of
 * animation frames before trusting a measurement. Without this, opening a
 * URL and the "panel is now visible, make sure it's positioned" effect could
 * both call into Rust with bounds measured at slightly different points in
 * the same layout pass (e.g. before vs. after the empty state unmounts) with
 * no ordering guarantee between the two IPC calls — whichever landed last
 * won, sometimes with stale bounds that left the panel covering this page's
 * own header instead of sitting below it. */
export function useBrowserPanel() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  containerRef.current = container;
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const currentBounds = () => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };

  const enqueue = (fn: () => Promise<void>) => {
    const next = queueRef.current.then(fn, fn);
    queueRef.current = next;
    return next;
  };

  /** Shows (creating on first use) and positions the panel, or just
   *  repositions it when `targetUrl` is null. Settles for two frames before
   *  measuring, then re-measures and corrects once more after the call
   *  completes — cheap, and it's what makes the initial placement reliable
   *  regardless of exactly when this fires relative to a layout change. */
  const showAt = (targetUrl: string | null) => enqueue(async () => {
    await nextFrame();
    await nextFrame();
    const rect = currentBounds();
    if (!rect) return;
    try {
      await invoke("browser_show", { ...rect, url: targetUrl });
      if (targetUrl) setUrl(targetUrl);
      setOpened(true);
      setError(null);
    } catch (e) {
      setError(String(e));
      return;
    }
    await nextFrame();
    const settled = currentBounds();
    if (settled) await invoke("browser_set_bounds", settled).catch(() => {});
    forceRepaint();
  });

  const reposition = () => enqueue(async () => {
    const rect = currentBounds();
    if (rect) await invoke("browser_set_bounds", rect).catch(() => {});
  });

  // Once the placeholder has laid out, check whether the panel is already
  // alive (a previous visit to this page, still running in the background)
  // and if so sync the address bar and reposition it under the placeholder.
  useEffect(() => {
    if (!container) return;
    invoke<BrowserState>("browser_get_state").then((state) => {
      if (!state.opened) return;
      setUrl(state.url);
      setTitle(state.title);
      void showAt(null);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(() => void reposition());
    observer.observe(container);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  useEffect(() => {
    const unlistens = [
      listen<string>("browser://navigated", (e) => setUrl(e.payload)),
      listen<string>("browser://title-changed", (e) => setTitle(e.payload)),
      listen<boolean>("browser://loading", (e) => setLoading(e.payload)),
    ];
    return () => { unlistens.forEach((p) => p.then((fn) => fn()).catch(() => {})); };
  }, []);

  // Leaving the page hides the native panel so it doesn't render over
  // whatever page comes next — see browser_panel's module doc.
  useEffect(() => () => { invoke("browser_hide").catch(() => {}); }, []);

  const open = (raw: string) => {
    const target = normalizeAddress(raw);
    if (!target) return Promise.resolve();
    return showAt(target);
  };

  const reload = () => invoke("browser_reload").catch(() => {});
  const goBack = () => invoke("browser_go_back").catch(() => {});
  const goForward = () => invoke("browser_go_forward").catch(() => {});
  const clearData = () => invoke("browser_clear_data");

  return {
    setContainer, url, title, loading, opened, error,
    open, reload, goBack, goForward, clearData,
  };
}
