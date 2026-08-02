import { create } from "zustand";

interface PendingChatSelectionState {
  text: string | null;
  setText: (text: string) => void;
  consume: () => string | null;
}

/** Bridges a selection made inside BlockNote to AI Chat when the Chat page is
 *  not mounted yet. AiChatPage consumes this on mount and prefills the input. */
export const usePendingChatSelectionStore = create<PendingChatSelectionState>((set, get) => ({
  text: null,
  setText: (text) => set({ text }),
  consume: () => {
    const text = get().text;
    set({ text: null });
    return text;
  },
}));
