import { create } from "zustand";

const COLLAPSE_KEY = "tanwords_sidebar_collapsed";

export const SIDEBAR_WIDTH = 210;
export const SIDEBAR_WIDTH_COLLAPSED = 60;

interface LayoutState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** True while a page's zen/fullscreen mode is open (reader, docs). Just one
   *  such overlay can be up at a time. AppBackground reads this: in zen mode it
   *  raises its z-index above the app chrome (sidebar/topbar/dock) so the
   *  wallpaper itself covers that chrome, keeping the navigation hidden. */
  zenMode: boolean;
  setZenMode: (active: boolean) => void;
}

/** Sidebar collapse state, lifted out of MainLayout so bottom-anchored global
 *  UI (player bars) can offset itself past the sidebar instead of overlapping it. */
export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSE_KEY) === "1",
  zenMode: false,

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    set({ sidebarCollapsed: next });
  },

  setZenMode: (active: boolean) => {
    if (get().zenMode === active) return;
    set({ zenMode: active });
  },
}));
