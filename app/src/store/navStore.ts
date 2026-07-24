import { create } from "zustand";

export type NavPage =
  | "dashboard"
  | "feeds"
  | "scene-lab"
  | "music"
  | "vocabulary"
  | "documents"
  | "chat"
  | "settings";

interface NavState {
  page: NavPage;
  wordId?: number;

  currentPage: () => NavPage;
  currentWordId: () => number | undefined;

  navigate: (page: NavPage, wordId?: number) => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  // Feeds is the app's home page — reading sources come first.
  page: "feeds",
  wordId: undefined,

  currentPage: () => get().page,
  currentWordId: () => get().wordId,

  navigate: (page, wordId) => set({ page, wordId }),
}));
