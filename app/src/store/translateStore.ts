import { create } from "zustand";
import { findBestProvider } from "@/providers/select";

export type TranslateStatus = "loading" | "ready" | "error" | "no-provider";

export interface TranslateJob {
  articleTranslation: string;
  articleStatus: TranslateStatus;
  articleError: string;
  commentsTranslation: string;
  commentsStatus: TranslateStatus;
  commentsError: string;
}

interface TranslateState {
  jobs: Record<string, TranslateJob>;
  /** Idempotent — resuming an already-started (or finished) job just re-shows its
   *  current state instead of re-running the AI call. Closing TranslateModal only
   *  hides it (see the component); the translation itself keeps running here,
   *  keyed by article+comments text rather than tied to the modal staying open. */
  start: (key: string, opts: { articleText: string; commentsText?: string }) => void;
  /** Re-runs unconditionally, discarding any cached result for this key — the
   *  escape hatch for "the model went off the rails, try again" (translation is
   *  otherwise cached for the app session, keyed by exact source text). */
  retry: (key: string, opts: { articleText: string; commentsText?: string }) => void;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

function runJob(
  key: string,
  { articleText, commentsText }: { articleText: string; commentsText?: string },
  set: (fn: (s: TranslateState) => Partial<TranslateState>) => void
) {
  const hasComments = Boolean(commentsText?.trim());
  set((s) => ({
    jobs: {
      ...s.jobs,
      [key]: {
        articleTranslation: "",
        articleStatus: "loading",
        articleError: "",
        commentsTranslation: "",
        commentsStatus: hasComments ? "loading" : "ready",
        commentsError: "",
      },
    },
  }));

  const patchJob = (patch: Partial<TranslateJob>) =>
    set((s) => {
      const job = s.jobs[key];
      if (!job) return s;
      return { jobs: { ...s.jobs, [key]: { ...job, ...patch } } };
    });

  const provider = findBestProvider();
  if (!provider) {
    patchJob({
      articleStatus: "no-provider",
      commentsStatus: hasComments ? "no-provider" : "ready",
    });
    return;
  }

  (async () => {
    try {
      let acc = "";
      for await (const chunk of provider.translate({ text: articleText, targetLang: "Chinese", mode: "translate" })) {
        acc += chunk;
        patchJob({ articleTranslation: acc });
      }
      patchJob({ articleStatus: "ready" });
    } catch (e) {
      patchJob({ articleStatus: "error", articleError: errorMessage(e) });
    }
  })();

  if (hasComments) {
    (async () => {
      try {
        let acc = "";
        // preserveMarkers: commentsText is a batch of @@id@@-delimited comment segments
        // (see lib/hnComments.ts's serializeCommentsForTranslation) — the modal splits
        // the result back apart by those markers to re-render each comment individually.
        for await (const chunk of provider.translate({ text: commentsText!, targetLang: "Chinese", mode: "translate", preserveMarkers: true })) {
          acc += chunk;
          patchJob({ commentsTranslation: acc });
        }
        patchJob({ commentsStatus: "ready" });
      } catch (e) {
        patchJob({ commentsStatus: "error", commentsError: errorMessage(e) });
      }
    })();
  }
}

export const useTranslateStore = create<TranslateState>((set, get) => ({
  jobs: {},
  start: (key, opts) => {
    if (get().jobs[key]) return;
    runJob(key, opts, set);
  },
  retry: (key, opts) => runJob(key, opts, set),
}));
