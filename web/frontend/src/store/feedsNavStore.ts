import { create } from "zustand";

export interface PendingBrowse {
  url: string;
  title: string;
  domain: string;
  audioUrl: string | null;
  feedTitle: string;
  hnItemId: number | null;
  /** Which Reading-page panel opened it — feeds and podcasts render side by
   *  side in the merged Reading page, so a browse belongs to one of them. */
  kind?: "article" | "podcast";
}

interface FeedsNavState {
  /** The article currently open in the Feeds page's in-app reader. Lives here —
   *  not in FeedsPage state — so leaving for another page (Settings, Dashboard…)
   *  and coming back restores the article instead of dumping the user on the
   *  feed list, and so other surfaces (player bar, dashboard widget) can open
   *  one directly. Null when the feed list is showing. */
  browse: PendingBrowse | null;
  setBrowse: (b: PendingBrowse | null) => void;
}

export const useFeedsNavStore = create<FeedsNavState>((set) => ({
  browse: null,
  setBrowse: (b) => set({ browse: b }),
}));
