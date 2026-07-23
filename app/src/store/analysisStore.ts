import { create } from "zustand";

/** Tracks the in-flight Learn/analyze call so its progress stays visible (and
 *  the call itself keeps running to completion) no matter which page the user
 *  navigates to while it's working — the underlying AI call isn't tied to
 *  ReadingPage staying mounted, only this UI-facing state used to be. */
interface AnalysisState {
  isAnalyzing: boolean;
  progress: number;
  start: () => void;
  setProgress: (n: number) => void;
  finish: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  isAnalyzing: false,
  progress: 0,
  start: () => set({ isAnalyzing: true, progress: 0 }),
  setProgress: (n) => set({ progress: n }),
  finish: () => set({ isAnalyzing: false, progress: 0 }),
}));
