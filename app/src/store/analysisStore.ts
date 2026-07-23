import { create } from "zustand";

export interface AnalysisJob {
  id: string;
  title: string;
  progress: number;
}

/** Tracks every in-flight Learn/analyze call (keyed by job id) so progress stays
 *  visible — and each call keeps running to completion — no matter which page
 *  the user navigates to while it's working, or how many are running at once
 *  (e.g. one kicked off from Reading plus several queued from the Feeds list
 *  in the background). The underlying AI call isn't tied to any page staying
 *  mounted, only this UI-facing state used to be. */
interface AnalysisState {
  jobs: AnalysisJob[];
  isAnalyzing: boolean;
  /** Most recently updated job's progress — kept for simple single-job UI. */
  progress: number;
  start: (id: string, title: string) => void;
  setProgress: (id: string, n: number) => void;
  finish: (id: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  jobs: [],
  isAnalyzing: false,
  progress: 0,
  start: (id, title) =>
    set((s) => ({ jobs: [...s.jobs, { id, title, progress: 0 }], isAnalyzing: true, progress: 0 })),
  setProgress: (id, n) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, progress: n } : j)), progress: n })),
  finish: (id) =>
    set((s) => {
      const jobs = s.jobs.filter((j) => j.id !== id);
      return { jobs, isAnalyzing: jobs.length > 0, progress: jobs[jobs.length - 1]?.progress ?? 0 };
    }),
}));
