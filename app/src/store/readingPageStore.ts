import { create } from "zustand";

/** Which article the Reading page is on, kept outside the component.
 *
 *  `App.tsx` renders exactly one page from a switch, so every other page is
 *  unmounted — the Reading page's own `useState` was destroyed the moment you
 *  looked something up elsewhere, and coming back always landed on a blank
 *  paste sheet no matter what you had been reading.
 *
 *  Module state rather than persisted storage: this restores across navigation
 *  within a session, which is what "go and come back" means here. It matches
 *  how the Browser page restores its tabs (from the still-running native
 *  panel) rather than from disk. */
interface ReadingPageState {
  /** Which of the two list views the page shows when no article is open. */
  view: "paste" | "library";
  /** The library row currently being read, or null for the list views. */
  openArticleId: number | null;
  /** Bumped to hand out a fresh paste sheet — the scratch reader is keyed on
   *  it, so incrementing discards whatever the last session left behind. */
  session: number;
  setView: (view: "paste" | "library") => void;
  openArticle: (id: number) => void;
  /** Back to the library list, with a clean sheet waiting under "paste". */
  backToLibrary: () => void;
}

export const useReadingPageStore = create<ReadingPageState>((set) => ({
  view: "paste",
  openArticleId: null,
  session: 1,
  setView: (view) => set({ view }),
  openArticle: (id) => set({ openArticleId: id }),
  backToLibrary: () =>
    set((s) => ({ openArticleId: null, view: "library", session: s.session + 1 })),
}));
