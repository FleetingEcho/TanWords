import { useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { subscribeAll } from "@/ipc/events";
import { useBrowserPanelBlockStore } from "@/store/browserPanelStore";
import { useFloatingBrowserStore } from "@/store/floatingBrowserStore";
import { useNavStore } from "@/store/navStore";
import { normalizeAddress } from "@/components/Browser/useBrowserPanel";

/** Same tab shape as the full-page Browser's hook — see useBrowserPanel.ts
 *  for field docs. This is a near-duplicate wired to the floating overlay's
 *  own `floating_browser_*` commands/tab-id namespace instead. */
export interface FloatingBrowserTab {
  key: string;
  panelId: string | null;
  url: string;
  title: string;
  loading: boolean;
  atHome: boolean;
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
const freshTab = (): FloatingBrowserTab => ({
  key: `floating-tab-${++keySeq}`,
  panelId: null,
  url: "",
  title: "",
  loading: false,
  atHome: true,
  preview: null,
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Owns the floating overlay's native panel lifecycle. Structurally the same
 *  as useBrowserPanel (see that file's module doc for the coordinate and
 *  queueing notes — they apply unchanged here), except visibility is driven
 *  by the floatingBrowserStore's `open` flag rather than route mount/unmount:
 *  the widget itself is mounted once at the app root and toggled, it never
 *  unmounts when the user navigates to another page.
 *
 *  Shared verbatim between the docked widget (FloatingBrowserWidget, in the
 *  main window) and the detached popout's own chrome (FloatingBrowserPopoutApp).
 *  Neither relies on unmounting to hide the native view — every path that
 *  needs the view hidden or moved (minimize, destroyAll, detach's
 *  reparentTo) does so explicitly at the point of action, deliberately not
 *  from an unmount effect here: an implicit unmount-triggered hide would
 *  fire for the detach case too and race reparentTo, possibly detaching the
 *  view from whichever window it was just moved *into*. */
export function useFloatingBrowserPanel(opts: { forceVisible?: boolean } = {}) {
  const { forceVisible = false } = opts;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  containerRef.current = container;

  const [tabs, setTabs] = useState<FloatingBrowserTab[]>(() => [freshTab()]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const unmountedRef = useRef(false);

  // Only "open" shows the native content — "minimized" and "closed" both hide
  // it (the difference between them is whether the tabs still exist at all).
  // The popout's own renderer has its own separate store instance (a
  // different JS context entirely) whose status is never anything but its
  // unused default — forceVisible skips that check there, since the popout
  // window existing at all already means "show it".
  const storeOpen = useFloatingBrowserStore((s) => s.status === "open");
  // The DSH page is its OWN native `WebContentsView`, layered independently
  // of this one — neither has a way to lose a z-index fight against the
  // other (native views don't respect each other's stacking any more than
  // they respect HTML z-index), so whichever's `show` IPC lands last just
  // paints over the other. Force this one to yield while DSH is the active
  // page, same as it already yields to a blocking dialog below. Read
  // straight off navStore rather than threading a prop through: the popout
  // window (see this hook's module doc) has its own separate `navStore`
  // instance that never leaves its default page, so this is always false
  // there — exactly the "popout always visible" behavior `forceVisible`
  // already carves out.
  const dshActive = useNavStore((s) => s.page === "dsh");
  const visible = (forceVisible || storeOpen) && !dshActive;
  // A modal/dropdown is up — same registry the full-page Browser panel uses,
  // since this is also a native view that can't lose a z-index fight.
  const blocked = useBrowserPanelBlockStore((s) => s.blockers > 0);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

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

  const patchTab = (key: string, patch: Partial<FloatingBrowserTab>) =>
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const showAt = (key: string, panelId: string | null, targetUrl: string | null) =>
    enqueue(async () => {
      await nextFrame();
      await nextFrame();
      if (unmountedRef.current) return;
      const rect = await currentBounds();
      if (!rect) return;
      try {
        const id = await invoke<string>("floating_browser_show", { tabId: panelId, ...rect, url: targetUrl });
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
      if (settled) await invoke("floating_browser_set_bounds", settled).catch(() => {});
    });

  const reposition = () =>
    enqueue(async () => {
      const rect = await currentBounds();
      if (rect) await invoke("floating_browser_set_bounds", rect).catch(() => {});
    });

  // Adopt whatever tabs are already alive once the screen placeholder has
  // laid out (e.g. the widget was closed and reopened; the tabs survived).
  useEffect(() => {
    if (!container) return;
    invoke<RemoteState>("floating_browser_get_state")
      .then((state) => {
        if (!state.tabs.length) return;
        const restored: FloatingBrowserTab[] = state.tabs.map((t) => ({
          key: `floating-tab-${++keySeq}`,
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
      // Surfaced rather than swallowed: a silent failure here reads as "the
      // page is gone" with no way to tell why.
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  // Reconciliation: show the active tab's native view only while the widget
  // is open and nothing is blocking it.
  useEffect(() => {
    if (!container || !active) return;
    if (!visible || blocked || active.atHome || !active.panelId) {
      const key = active.key;
      const wasShowing = visible && blocked && !active.atHome && !!active.panelId;
      void enqueue(async () => {
        const snapshot = await invoke<string | null>("floating_browser_hide", { withSnapshot: wasShowing }).catch(() => null);
        if (wasShowing) patchTab(key, { preview: snapshot });
      });
      return;
    }
    void showAt(active.key, active.panelId, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, visible, blocked, active?.key, active?.panelId, active?.atHome]);

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
    const patchByPanel = (tabId: string, patch: Partial<FloatingBrowserTab>) =>
      setTabs((prev) => prev.map((t) => (t.panelId === tabId ? { ...t, ...patch } : t)));
    return subscribeAll({
      "browser://navigated": (e: TabEvent<string>) => patchByPanel(e.tabId, { url: e.value }),
      "browser://title-changed": (e: TabEvent<string>) => patchByPanel(e.tabId, { title: e.value }),
      "browser://loading": (e: TabEvent<boolean>) => patchByPanel(e.tabId, { loading: e.value }),
    });
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openUrl = (raw: string) => {
    const target = normalizeAddress(raw);
    if (!target || !active) return Promise.resolve();
    return showAt(active.key, active.panelId, target);
  };

  const goHome = () => {
    if (!active) return;
    if (active.panelId) invoke("floating_browser_go_home", { tabId: active.panelId }).catch(() => {});
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
    if (panelId) invoke("floating_browser_close_tab", { tabId: panelId }).catch(() => {});
    const rest = tabs.filter((t) => t.key !== key);
    const next = rest.length ? rest : [freshTab()];
    setTabs(next);
    if (key === active?.key) setActiveKey(next[Math.min(index, next.length - 1)].key);
  };

  const onActive = (command: string) =>
    active?.panelId ? invoke(command, { tabId: active.panelId }).catch(() => {}) : Promise.resolve();

  const reload = () => onActive("floating_browser_reload");
  const goBack = () => onActive("floating_browser_go_back");
  const goForward = () => onActive("floating_browser_go_forward");

  /** The confirmed "close" action: destroys every tab's native view (not
   *  just hides them, like minimizing does) and resets back to a single
   *  fresh home tab. Cookies/login survive — those live in the session
   *  partition shared with the full-page Browser, not in these tabs. */
  const destroyAll = () => {
    for (const tab of tabs) {
      if (tab.panelId) invoke("floating_browser_close_tab", { tabId: tab.panelId }).catch(() => {});
    }
    const fresh = freshTab();
    setTabs([fresh]);
    setActiveKey(fresh.key);
  };

  return {
    setContainer,
    tabs,
    active,
    error,
    open: openUrl,
    reload,
    goBack,
    goForward,
    goHome,
    newTab,
    selectTab,
    closeTab,
    destroyAll,
  };
}
