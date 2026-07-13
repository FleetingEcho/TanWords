import { create } from "zustand";

export type NavPage =
  | "dashboard"
  | "feeds"
  | "reading"
  | "vocabulary"
  | "documents"
  | "chat"
  | "settings";

interface NavEntry {
  page: NavPage;
  wordId?: number;
}

interface NavState {
  history: NavEntry[];
  historyIndex: number;

  currentPage: () => NavPage;
  currentWordId: () => number | undefined;
  canGoBack: () => boolean;
  canGoForward: () => boolean;

  navigate: (page: NavPage, wordId?: number) => void;
  goBack: () => void;
  goForward: () => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  // Feeds is the app's home page — reading sources come first.
  history: [{ page: "feeds" }],
  historyIndex: 0,

  currentPage: () => {
    const { history, historyIndex } = get();
    return history[historyIndex]?.page ?? "feeds";
  },

  currentWordId: () => {
    const { history, historyIndex } = get();
    return history[historyIndex]?.wordId;
  },

  canGoBack: () => get().historyIndex > 0,
  canGoForward: () => get().historyIndex < get().history.length - 1,

  navigate: (page, wordId) => {
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push({ page, wordId });
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    });
  },

  goBack: () => {
    const { historyIndex, canGoBack } = get();
    if (canGoBack()) {
      set({ historyIndex: historyIndex - 1 });
    }
  },

  goForward: () => {
    const { historyIndex, canGoForward } = get();
    if (canGoForward()) {
      set({ historyIndex: historyIndex + 1 });
    }
  },
}));
