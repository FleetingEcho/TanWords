import { create } from "zustand";

export interface ReaderArticleContext {
  url: string;
  title: string;
  text: string;
  hnItemId: number | null;
  /** Flattened HN comment text, filled in once the thread loads (may arrive
   *  after the article itself) — included in analysis when present. */
  commentsText?: string;
}

/** Bridges ArticleReader (which has the article, but no longer owns the analyze
 *  trigger) and CommandBar (which owns the trigger button, but has no article of
 *  its own — it acts on whatever's currently open in the reader). ArticleReader
 *  publishes its article here as it loads and renders the notes pane from this
 *  store; CommandBar reads/writes it to kick off analysis and reflect the result,
 *  regardless of which page you're on by the time it finishes. */
interface ReaderNotesState {
  article: ReaderArticleContext | null;
  notesMarkdown: string | null;
  showNotes: boolean;
  analyzing: boolean;
  setArticle: (article: ReaderArticleContext | null) => void;
  setCommentsText: (commentsText: string | undefined) => void;
  setShowNotes: (v: boolean) => void;
  setAnalyzing: (v: boolean) => void;
  setNotesMarkdown: (markdown: string | null) => void;
}

export const useReaderNotesStore = create<ReaderNotesState>((set) => ({
  article: null,
  notesMarkdown: null,
  showNotes: false,
  analyzing: false,
  setArticle: (article) => set({ article, notesMarkdown: null, showNotes: false, analyzing: false }),
  setCommentsText: (commentsText) =>
    set((s) => (s.article ? { article: { ...s.article, commentsText } } : s)),
  setShowNotes: (v) => set({ showNotes: v }),
  setAnalyzing: (v) => set({ analyzing: v }),
  setNotesMarkdown: (markdown) => set({ notesMarkdown: markdown }),
}));
