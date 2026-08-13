import { create } from "zustand";
import { isDesktopHost } from "@/platform";
import { subscribeAll } from "@/ipc/events";

const POS_KEY = "tanwords_floating_browser_pos";
const SIZE_KEY = "tanwords_floating_browser_size";

interface Pos {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

/** iPhone-ish logical viewport (roughly iPhone 15/16 Pro's 393x852 points),
 *  clamped to fit the current viewport so it never opens larger than the
 *  screen on a small laptop. */
function defaultSize(): Size {
  return {
    width: Math.min(393, window.innerWidth - 40),
    height: Math.min(852, window.innerHeight - 80),
  };
}

function defaultPos(): Pos {
  const { width, height } = defaultSize();
  return {
    x: Math.max(0, (window.innerWidth - width) / 2 + 120),
    y: Math.max(0, (window.innerHeight - height) / 2),
  };
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return defaultPos();
}

function loadSize(): Size {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return defaultSize();
}

/** `closed`: no tabs, nothing running — reached only via the confirmed
 *  "destroy" action. `minimized`: hidden, but tabs/native views are still
 *  alive in the background — reached via the widget's own minimize button,
 *  and what the CommandBar icon's green dot indicates. `open`: visible,
 *  docked in the main window. `detached`: dragged out into its own
 *  independent, visible window (see floatingBrowserWindow.ts/
 *  FloatingBrowserPopoutApp) — the docked widget renders nothing in this
 *  state, since its content now belongs to a different window.
 *  `detachedHidden`: that popout window still exists (tab still running) but
 *  is hidden via its own minimize button — the CommandBar icon shows it
 *  again from here, same green-dot treatment as "minimized". */
export type FloatingBrowserStatus = "closed" | "minimized" | "open" | "detached" | "detachedHidden";

interface FloatingBrowserState {
  /** Not persisted — the widget always starts closed on launch, same as
   *  ToolsModal's isOpen. */
  status: FloatingBrowserStatus;
  pos: Pos;
  size: Size;
  /** Opens fresh, or restores from minimized — same position/size either way,
   *  since those are never reset by minimizing or closing. */
  open: () => void;
  minimize: () => void;
  /** Only the confirmed "destroy" action should call this — the caller is
   *  responsible for tearing down the native tabs first (see
   *  useFloatingBrowserPanel's destroyAll). */
  close: () => void;
  /** Set locally the instant a drag crosses out of the main window's bounds
   *  (see FloatingBrowserWidget's detach trigger) — the popout window itself
   *  is created asynchronously in main, but the docked widget must disappear
   *  immediately, not wait on that round trip. */
  detach: () => void;
  /** CommandBar icon click: open→minimize, closed/minimized→open. Does
   *  nothing useful for "detached" — the caller should send
   *  floating_browser_dock instead; see CommandBar.tsx. */
  toggleFromIcon: () => void;
  setPos: (pos: Pos, persist?: boolean) => void;
  setSize: (size: Size, persist?: boolean) => void;
}

export const useFloatingBrowserStore = create<FloatingBrowserState>((set, get) => ({
  status: "closed",
  pos: loadPos(),
  size: loadSize(),

  open: () => set({ status: "open" }),
  minimize: () => set({ status: "minimized" }),
  close: () => set({ status: "closed" }),
  detach: () => set({ status: "detached" }),

  toggleFromIcon: () => set({ status: get().status === "open" ? "minimized" : "open" }),

  setPos: (pos, persist = true) => {
    set({ pos });
    if (persist) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  },

  setSize: (size, persist = true) => {
    set({ size });
    if (persist) localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  },
}));

// Kept in sync with the popout window's lifecycle from the main process side
// (dock completing, or the popout being closed directly) — see
// floatingBrowserWindow.ts's two broadcastEvent("floatingBrowser:statusChanged", ...)
// call sites. Module-level rather than a hook: this must update the store
// regardless of whether any component that cares is currently mounted (the
// docked widget itself unmounts while detached).
if (isDesktopHost) {
  subscribeAll({
    "floatingBrowser:statusChanged": (payload: { status: "open" | "closed" | "detached" | "detachedHidden" }) => {
      useFloatingBrowserStore.setState({ status: payload.status });
    },
  });
}
