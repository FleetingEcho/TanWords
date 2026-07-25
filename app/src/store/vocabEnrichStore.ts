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
  finishSingle: (word: string, status: "done" | "error") => void;
  cancelSingle: (word: string) => void;
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
  startSingle: (word) => {
    get().singleJobs[word]?.controller.abort();
    const controller = new AbortController();
    set((s) => ({ singleJobs: { ...s.singleJobs, [word]: { status: "running", controller } } }));
    return controller;
  },
  finishSingle: (word, status) =>
    set((s) => {
      const job = s.singleJobs[word];
      if (!job) return s;
      return { singleJobs: { ...s.singleJobs, [word]: { ...job, status } } };
    }),
  cancelSingle: (word) => get().singleJobs[word]?.controller.abort(),
}));
