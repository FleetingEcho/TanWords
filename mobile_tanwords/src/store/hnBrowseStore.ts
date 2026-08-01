import { create } from "zustand";

export type HnSection = "top" | "new" | "best";

export interface HnStorySummary {
  id: number;
  title: string;
  url: string;
  by: string | null;
  score: number | null;
  time: number | null;
  descendants: number | null;
}

/** Persists the native Hacker News browser's tab/search/story-list state across
 *  mount cycles — HackerNewsSection unmounts whenever the user opens an article
 *  (FeedsMainContent swaps it for ReaderView), so plain useState would reset the
 *  section back to "Top" and refetch every time the user returns to the list. */
interface HnBrowseState {
  section: HnSection;
  query: string;
  activeQuery: string;
  stories: HnStorySummary[];
  hasMore: boolean;
  status: "loading" | "ready" | "error";
  nextSearchPage: number;
  /** Identifies which section/search the cached `stories` belong to (e.g. "section:top",
   *  "search:rust") — lets the component tell "already loaded, just remount" apart from
   *  "the user actually switched view" without refetching on every remount. */
  loadedKey: string | null;
  setSection: (s: HnSection) => void;
  setQuery: (q: string) => void;
  setActiveQuery: (q: string) => void;
  setStories: (updater: HnStorySummary[] | ((prev: HnStorySummary[]) => HnStorySummary[])) => void;
  setHasMore: (v: boolean) => void;
  setStatus: (v: "loading" | "ready" | "error") => void;
  setNextSearchPage: (n: number) => void;
  setLoadedKey: (k: string | null) => void;
}

export const useHnBrowseStore = create<HnBrowseState>((set) => ({
  section: "top",
  query: "",
  activeQuery: "",
  stories: [],
  hasMore: false,
  status: "loading",
  nextSearchPage: 0,
  loadedKey: null,
  setSection: (section) => set({ section }),
  setQuery: (query) => set({ query }),
  setActiveQuery: (activeQuery) => set({ activeQuery }),
  setStories: (updater) =>
    set((s) => ({ stories: typeof updater === "function" ? (updater as (prev: HnStorySummary[]) => HnStorySummary[])(s.stories) : updater })),
  setHasMore: (hasMore) => set({ hasMore }),
  setStatus: (status) => set({ status }),
  setNextSearchPage: (nextSearchPage) => set({ nextSearchPage }),
  setLoadedKey: (loadedKey) => set({ loadedKey }),
}));
