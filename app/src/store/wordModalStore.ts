import { create } from "zustand";

interface WordModalState {
  word: string | null;
  openWordModal: (word: string) => void;
  closeWordModal: () => void;
}

export const useWordModalStore = create<WordModalState>((set) => ({
  word: null,
  openWordModal: (word) => set({ word }),
  closeWordModal: () => set({ word: null }),
}));
