import { create } from "zustand";

export type LearnJobStatus = "running" | "done" | "error";

interface LearnJob {
  status: LearnJobStatus;
  controller: AbortController;
  /** Created when the job starts so its live transcript can be opened. */
  sessionId: string;
}

interface LearnChatState {
  jobs: Record<string, LearnJob>;
  start: (articleUrl: string, controller: AbortController, sessionId: string) => void;
  finishSuccess: (articleUrl: string, sessionId: string) => void;
  finishError: (articleUrl: string) => void;
  cancel: (articleUrl: string) => void;
  dismiss: (articleUrl: string) => void;
  /** Called when a chat session is deleted from AI Chat — without this, a "done" job
   *  left pointing at a sessionId that no longer exists in the DB would still show the
   *  reader/RSS-card checkmark, and clicking it would open a chat modal with nothing in it. */
  dismissBySessionId: (sessionId: string) => void;
}

/** Tracks the background "Learn" AI-chat job per article URL, so the reader's
 *  learn button reflects running/done/error state even after the user has
 *  navigated to a different article — the AI call itself isn't tied to
 *  ArticleReader's lifetime, only this store is what survives it. */
export const useLearnChatStore = create<LearnChatState>((set, get) => ({
  jobs: {},
  start: (articleUrl, controller, sessionId) =>
    set((s) => ({ jobs: { ...s.jobs, [articleUrl]: { status: "running", controller, sessionId } } })),
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
  dismissBySessionId: (sessionId) =>
    set((s) => {
      const entries = Object.entries(s.jobs).filter(([, job]) => job.sessionId !== sessionId);
      if (entries.length === Object.keys(s.jobs).length) return s;
      return { jobs: Object.fromEntries(entries) };
    }),
}));
