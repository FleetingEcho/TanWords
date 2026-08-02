import { create } from "zustand";

const COLLAPSE_KEY = "tanwords_sidebar_collapsed";

export const SIDEBAR_WIDTH = 210;
export const SIDEBAR_WIDTH_COLLAPSED = 60;

interface LayoutState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

/** Sidebar collapse state, lifted out of MainLayout so bottom-anchored global
 *  UI (player bars) can offset itself past the sidebar instead of overlapping it. */
export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSE_KEY) === "1",

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    set({ sidebarCollapsed: next });
  },
}));
