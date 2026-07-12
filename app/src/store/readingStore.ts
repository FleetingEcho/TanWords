import { create } from "zustand";

export interface ReadingDraft {
  title: string;
  text: string;
  sourceUrl: string;
  origin: "pasted" | "hackernews";
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

  /** Pattern to open directly (e.g. re-encounter popover "查看句式") — consumed on Patterns page mount */
  pendingPatternId: number | null;
  setPendingPatternId: (id: number) => void;
  clearPendingPatternId: () => void;
}

export const useReadingStore = create<ReadingState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),

  pendingArticleId: null,
  setPendingArticleId: (id) => set({ pendingArticleId: id }),
  clearPendingArticleId: () => set({ pendingArticleId: null }),

  pendingPatternId: null,
  setPendingPatternId: (id) => set({ pendingPatternId: id }),
  clearPendingPatternId: () => set({ pendingPatternId: null }),
}));
