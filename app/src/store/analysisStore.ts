import { create } from "zustand";

export interface AnalysisJob {
  id: string;
  title: string;
  progress: number;
  controller: AbortController;
}

/** Tracks every in-flight Learn/analyze call (keyed by job id) so progress stays
 *  visible — and each call keeps running to completion — no matter which page
 *  the user navigates to while it's working, or how many are running at once
 *  (e.g. one kicked off from Reading plus several queued from the Feeds list
 *  in the background). The underlying AI call isn't tied to any page staying
 *  mounted, only this UI-facing state used to be. Each job carries its own
 *  AbortController so it can be cancelled from anywhere (e.g. CommandBar's
 *  global indicator) without the caller needing a reference back to it. */
interface AnalysisState {
  jobs: AnalysisJob[];
  isAnalyzing: boolean;
  /** Most recently updated job's progress — kept for simple single-job UI. */
  progress: number;
  start: (id: string, title: string, controller: AbortController) => void;
  setProgress: (id: string, n: number) => void;
  finish: (id: string) => void;
  /** Aborts the underlying AI call — the job removes itself from `jobs` once
   *  the resulting AbortError unwinds through the caller's finally block. */
  cancel: (id: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  jobs: [],
  isAnalyzing: false,
  progress: 0,
  start: (id, title, controller) =>
    set((s) => ({ jobs: [...s.jobs, { id, title, progress: 0, controller }], isAnalyzing: true, progress: 0 })),
  setProgress: (id, n) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, progress: n } : j)), progress: n })),
  finish: (id) =>
    set((s) => {
      const jobs = s.jobs.filter((j) => j.id !== id);
      return { jobs, isAnalyzing: jobs.length > 0, progress: jobs[jobs.length - 1]?.progress ?? 0 };
    }),
  cancel: (id) => get().jobs.find((j) => j.id === id)?.controller.abort(),
}));
