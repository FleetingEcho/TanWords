import { useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { subscribeAll } from "@/ipc/events";
import { useBrowserPanelBlockStore } from "@/store/browserPanelStore";

/** One entry in the tab strip.
 *
 *  `key` is this component's own stable React key. `panelId` is the id Rust
 *  assigned to the tab's native webview, and stays null until the tab has
 *  actually opened something — a brand-new tab sits on the home screen with
 *  no webview behind it at all. */
export interface BrowserTab {
  key: string;
  panelId: string | null;
  url: string;
  title: string;
  loading: boolean;
  /** Showing the home screen: the webview (if any) is hidden, not closed. */
  atHome: boolean;
  /** A still frame of the page, shown in place of the native view while a
   *  modal has it hidden (see `blocked` below) — without this the page reads
   *  as "gone" rather than "stepped aside" for the duration. Cleared as soon
   *  as the view is shown again. */
  preview: string | null;
}

interface RemoteTab {
  id: string;
  url: string;
  title: string;
  atHome: boolean;
}

interface RemoteState {
  tabs: RemoteTab[];
  active: string | null;
}

interface TabEvent<T> {
  tabId: string;
  value: T;
}

let keySeq = 0;
const freshTab = (): BrowserTab => ({
  key: `tab-${++keySeq}`,
  panelId: null,
  url: "",
  title: "",
  loading: false,
  atHome: true,
  preview: null,
});

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

/** NOTE ON COORDINATES: `WebContentsView.setBounds` takes DIPs relative to the
 *  host window's *content area*, which is exactly what this document's viewport
 *  is — so `getBoundingClientRect()` values go through unmodified, with no
 *  vertical offset. (Under the old Tauri/WKWebView backend a child webview was
 *  a sibling NSView measured from the top of the window frame, which sat ~32px
 *  above DOM y=0 and needed a correction. Electron does not: do not reintroduce
 *  a nonzero offset here — a plausible-looking one is what puts the panel over
 *  the page header.) */

/** Owns the native browser panel's lifecycle: one webview per tab, positioned
 * under a placeholder element, plus the address/nav actions that drive them.
 * The webviews outlive this hook's mounted lifetime (see browser_panel's
 * module doc) — `browser_get_state` on mount rebuilds the strip from the tabs
 * that actually exist rather than resetting to a single empty one.
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

  const [tabs, setTabs] = useState<BrowserTab[]>(() => [freshTab()]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // A modal/dropdown is up. The panel is a native view composited above all
  // of our HTML, so it has to step aside rather than lose a z-index fight.
  const blocked = useBrowserPanelBlockStore((s) => s.blockers > 0);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  /** The placeholder's rect, in the content-area coordinates the panel is
   *  positioned in — the same coordinates, see the note above. */
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

  const patchTab = (key: string, patch: Partial<BrowserTab>) =>
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  /** Shows (creating on first use) and positions one tab's webview, or just
   *  reveals it where it already is when `targetUrl` is null. Settles for two
   *  frames before measuring, then re-measures and corrects once more after
   *  the call completes — cheap, and it's what makes the initial placement
   *  reliable regardless of exactly when this fires relative to a layout
   *  change. */
  const showAt = (key: string, panelId: string | null, targetUrl: string | null) =>
    enqueue(async () => {
      await nextFrame();
      await nextFrame();
      const rect = await currentBounds();
      if (!rect) return;
      try {
        const id = await invoke<string>("browser_show", { tabId: panelId, ...rect, url: targetUrl });
        patchTab(key, {
          panelId: id,
          atHome: false,
          preview: null,
          ...(targetUrl ? { url: targetUrl } : {}),
        });
        setError(null);
      } catch (e) {
        setError(String(e));
        return;
      }
      await nextFrame();
      const settled = await currentBounds();
      if (settled) await invoke("browser_set_bounds", settled).catch(() => {});
    });

  const reposition = () =>
    enqueue(async () => {
      const rect = await currentBounds();
      if (rect) await invoke("browser_set_bounds", rect).catch(() => {});
    });

  // Once the placeholder has laid out, adopt whatever tabs are already alive
  // (a previous visit to this page, still running in the background).
  useEffect(() => {
    if (!container) return;
    invoke<RemoteState>("browser_get_state")
      .then((state) => {
        if (!state.tabs.length) return;
        const restored: BrowserTab[] = state.tabs.map((t) => ({
          key: `tab-${++keySeq}`,
          panelId: t.id,
          url: t.url,
          title: t.title,
          loading: false,
          atHome: t.atHome,
          preview: null,
        }));
        setTabs(restored);
        setActiveKey(restored.find((t) => t.panelId === state.active)?.key ?? restored[0].key);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  // Single reconciliation point: make the native side match whichever tab is
  // active. Tab switches and the home button only touch React state, and this
  // reveals/hides the right webview afterwards.
  useEffect(() => {
    if (!container || !active) return;
    if (blocked || active.atHome || !active.panelId) {
      const key = active.key;
      const wasShowing = blocked && !active.atHome && !!active.panelId;
      void enqueue(async () => {
        const snapshot = await invoke<string | null>("browser_hide", {}).catch(() => null);
        if (wasShowing) patchTab(key, { preview: snapshot });
      });
      return;
    }
    // Re-showing after a blocker clears is just `setHidden(false)` natively,
    // so the page keeps its scroll position and in-page state.
    void showAt(active.key, active.panelId, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, blocked, active?.key, active?.panelId, active?.atHome]);

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
    const patchByPanel = (tabId: string, patch: Partial<BrowserTab>) =>
      setTabs((prev) => prev.map((t) => (t.panelId === tabId ? { ...t, ...patch } : t)));
    return subscribeAll({
      "browser://navigated": (e: TabEvent<string>) => patchByPanel(e.tabId, { url: e.value }),
      "browser://title-changed": (e: TabEvent<string>) => patchByPanel(e.tabId, { title: e.value }),
      "browser://loading": (e: TabEvent<boolean>) => patchByPanel(e.tabId, { loading: e.value }),
    });
  }, []);

  // Leaving the page hides every panel so none of them render over whatever
  // page comes next — see browser_panel's module doc.
  useEffect(() => () => { invoke("browser_hide", {}).catch(() => {}); }, []);

  const open = (raw: string) => {
    const target = normalizeAddress(raw);
    if (!target || !active) return Promise.resolve();
    return showAt(active.key, active.panelId, target);
  };

  /** Back to the home screen without discarding the tab — the webview is
   *  hidden rather than closed, so the session (and the shared cookie jar)
   *  survives. The address and title clear with it: a tab showing the home
   *  screen has no address, and leaving the old one in the bar was the whole
   *  complaint. Rust records this too, so a page remount doesn't resurrect
   *  the site the tab was sent home from. */
  const goHome = () => {
    if (!active) return;
    if (active.panelId) invoke("browser_go_home", { tabId: active.panelId }).catch(() => {});
    patchTab(active.key, { atHome: true, url: "", title: "", loading: false });
  };

  const newTab = () => {
    const tab = freshTab();
    setTabs((prev) => [...prev, tab]);
    setActiveKey(tab.key);
  };

  const selectTab = (key: string) => setActiveKey(key);

  const closeTab = (key: string) => {
    const index = tabs.findIndex((t) => t.key === key);
    if (index === -1) return;
    const panelId = tabs[index].panelId;
    if (panelId) invoke("browser_close_tab", { tabId: panelId }).catch(() => {});
    const rest = tabs.filter((t) => t.key !== key);
    // Closing the last tab leaves an empty home tab rather than a blank page.
    const next = rest.length ? rest : [freshTab()];
    setTabs(next);
    if (key === active?.key) setActiveKey(next[Math.min(index, next.length - 1)].key);
  };

  const onActive = (command: string) =>
    active?.panelId ? invoke(command, { tabId: active.panelId }).catch(() => {}) : Promise.resolve();

  const reload = () => onActive("browser_reload");
  const goBack = () => onActive("browser_go_back");
  const goForward = () => onActive("browser_go_forward");
  /** Throws away cookies/localStorage/cache for every tab, then reloads the
   *  active one so the effect is immediately visible. Rejects rather than
   *  swallowing, so the caller can surface a toast. */
  const clearData = async () => {
    await invoke("browser_clear_data");
    if (active?.panelId) await invoke("browser_reload", { tabId: active.panelId }).catch(() => {});
  };

  return {
    setContainer,
    tabs,
    active,
    error,
    open,
    reload,
    goBack,
    goForward,
    goHome,
    clearData,
    newTab,
    selectTab,
    closeTab,
  };
}
