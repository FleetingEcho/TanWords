import { create } from "zustand";

interface VoiceAssistantState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/** Just open/closed state for the global floating voice button + its overlay.
 *  Everything else (recording/transcribing/messages) is ephemeral component
 *  state inside VoiceOverlay — this app deliberately keeps no session/history
 *  for the voice assistant, so there is nothing else worth lifting here. */
export const useVoiceAssistantStore = create<VoiceAssistantState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),
}));
