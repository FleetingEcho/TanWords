import { create } from "zustand";

export interface PendingBrowse {
  url: string;
  title: string;
  domain: string;
  audioUrl: string | null;
  feedTitle: string;
}

interface FeedsNavState {
  /** In-app reader to reopen (e.g. jumping back from the player bar) — consumed on Feeds page mount. */
  pendingBrowse: PendingBrowse | null;
  setPendingBrowse: (b: PendingBrowse) => void;
  clearPendingBrowse: () => void;
}

export const useFeedsNavStore = create<FeedsNavState>((set) => ({
  pendingBrowse: null,
  setPendingBrowse: (b) => set({ pendingBrowse: b }),
  clearPendingBrowse: () => set({ pendingBrowse: null }),
}));
