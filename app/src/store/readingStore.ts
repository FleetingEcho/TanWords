import { create } from "zustand";

export interface ReadingDraft {
  title: string;
  text: string;
  sourceUrl: string;
  origin: "pasted" | "hackernews" | "rss";
  /** Flattened HN comment text, when loaded — analyzed separately (native/colloquial usage prompt). */
  commentsText?: string;
  /** Set for entries from Hacker News (or hnrss-style feeds) — carried through so the
   * saved lesson can show the original discussion thread, not just its AI analysis. */
  hnItemId?: number | null;
}

interface ReadingState {
  /** Draft handed over from another page (e.g. HN drawer) — consumed on Reading page mount */
  draft: ReadingDraft | null;
  setDraft: (draft: ReadingDraft) => void;
  clearDraft: () => void;

  /** Lesson to open directly (e.g. Dashboard "continue learning") — consumed on Reading page mount */
  pendingArticleId: number | null;
  setPendingArticleId: (id: number) => void;
  clearPendingArticleId: () => void;
}

export const useReadingStore = create<ReadingState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),

  pendingArticleId: null,
  setPendingArticleId: (id) => set({ pendingArticleId: id }),
  clearPendingArticleId: () => set({ pendingArticleId: null }),
}));
