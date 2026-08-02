import { create } from "zustand";

export interface VocabBulkJob {
  running: boolean;
  done: number;
  total: number;
  controller: AbortController | null;
}

interface SingleJob {
  status: "running" | "done" | "error";
  controller: AbortController;
}

interface VocabEnrichState {
  /** Bulk (enrich-unanalyzed / re-analyze-all / re-analyze-selected) — global rather than
   *  VocabularyPage component state, so navigating away mid-run neither aborts it nor makes
   *  its progress invisible; CommandBar's "Analyzing" indicator reads this from anywhere. */
  bulk: VocabBulkJob;
  startBulk: (total: number) => AbortController;
  setBulkProgress: (done: number) => void;
  finishBulk: () => void;

  /** Single-word re-analyze (detail panel's "Re-enrich"), keyed by word — same reasoning. */
  singleJobs: Record<string, SingleJob>;
  startSingle: (word: string) => AbortController;
  finishSingle: (word: string, status: "done" | "error", controller?: AbortController) => void;
  clearSingle: (word: string, controller?: AbortController) => void;
  cancelSingle: (word: string) => void;

  /** Live partial stream of each running single-word job, so switching to another word and
   *  back re-renders the text that arrived while the detail panel wasn't showing it. Kept in
   *  its own map (not inside SingleJob) so per-chunk updates don't churn `singleJobs`, which
   *  CommandBar's background-job indicator subscribes to. */
  singleTexts: Record<string, string>;
  setSingleText: (word: string, text: string) => void;
}

export const useVocabEnrichStore = create<VocabEnrichState>((set, get) => ({
  bulk: { running: false, done: 0, total: 0, controller: null },
  startBulk: (total) => {
    get().bulk.controller?.abort();
    const controller = new AbortController();
    set({ bulk: { running: true, done: 0, total, controller } });
    return controller;
  },
  setBulkProgress: (done) => set((s) => ({ bulk: { ...s.bulk, done } })),
  finishBulk: () => set((s) => ({ bulk: { ...s.bulk, running: false, controller: null } })),

  singleJobs: {},
  singleTexts: {},
  startSingle: (word) => {
    get().singleJobs[word]?.controller.abort();
    const controller = new AbortController();
    set((s) => ({
      singleJobs: { ...s.singleJobs, [word]: { status: "running", controller } },
      singleTexts: { ...s.singleTexts, [word]: "" },
    }));
    return controller;
  },
  // `controller` guards against a stale run (one that was aborted because a newer re-analyze
  // of the same word took over) resolving late and overwriting the newer job's state.
  finishSingle: (word, status, controller) =>
    set((s) => {
      const job = s.singleJobs[word];
      if (!job || (controller && job.controller !== controller)) return s;
      const { [word]: _dropped, ...singleTexts } = s.singleTexts;
      return { singleJobs: { ...s.singleJobs, [word]: { ...job, status } }, singleTexts };
    }),
  clearSingle: (word, controller) =>
    set((s) => {
      const job = s.singleJobs[word];
      if (!job || (controller && job.controller !== controller)) return s;
      const { [word]: _droppedJob, ...singleJobs } = s.singleJobs;
      const { [word]: _droppedText, ...singleTexts } = s.singleTexts;
      return { singleJobs, singleTexts };
    }),
  cancelSingle: (word) => get().singleJobs[word]?.controller.abort(),
  setSingleText: (word, text) => set((s) => ({ singleTexts: { ...s.singleTexts, [word]: text } })),
}));
