import { create } from "zustand";

export interface SelectedWordState {
  wordId: number | null;
  word: string;
  enrichedContext: string;
  setSelectedWord: (data: { wordId: number | null; word: string; enrichedContext: string }) => void;
  clear: () => void;
}

/** Currently selected word on the Vocabulary page, shared with ToolsModal's
 *  word-chat tab (which has no direct access to VocabularyPage's local state). */
export const useSelectedWordStore = create<SelectedWordState>((set) => ({
  wordId: null,
  word: "",
  enrichedContext: "",
  setSelectedWord: (data) => set(data),
  clear: () => set({ wordId: null, word: "", enrichedContext: "" }),
}));
