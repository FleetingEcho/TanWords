import { create } from "zustand";

export type LearnJobStatus = "running" | "done" | "error";

interface LearnJob {
  status: LearnJobStatus;
  controller: AbortController;
  /** Set once the analysis lands and the chat conversation is saved. */
  sessionId?: string;
}

interface LearnChatState {
  jobs: Record<string, LearnJob>;
  start: (articleUrl: string, controller: AbortController) => void;
  finishSuccess: (articleUrl: string, sessionId: string) => void;
  finishError: (articleUrl: string) => void;
  cancel: (articleUrl: string) => void;
  dismiss: (articleUrl: string) => void;
}

/** Tracks the background "Learn" AI-chat job per article URL, so the reader's
 *  learn button reflects running/done/error state even after the user has
 *  navigated to a different article — the AI call itself isn't tied to
 *  ArticleReader's lifetime, only this store is what survives it. */
export const useLearnChatStore = create<LearnChatState>((set, get) => ({
  jobs: {},
  start: (articleUrl, controller) =>
    set((s) => ({ jobs: { ...s.jobs, [articleUrl]: { status: "running", controller } } })),
  finishSuccess: (articleUrl, sessionId) =>
    set((s) => {
      const job = s.jobs[articleUrl];
      if (!job) return s;
      return { jobs: { ...s.jobs, [articleUrl]: { ...job, status: "done", sessionId } } };
    }),
  finishError: (articleUrl) =>
    set((s) => {
      const job = s.jobs[articleUrl];
      if (!job) return s;
      return { jobs: { ...s.jobs, [articleUrl]: { ...job, status: "error" } } };
    }),
  cancel: (articleUrl) => get().jobs[articleUrl]?.controller.abort(),
  dismiss: (articleUrl) =>
    set((s) => {
      const { [articleUrl]: _removed, ...rest } = s.jobs;
      return { jobs: rest };
    }),
}));
