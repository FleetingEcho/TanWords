import { create } from "zustand";
import { findBestProvider } from "@/providers/select";
import type { AIProvider } from "@/providers/base";
import { isContextOverflowError } from "@/components/AiChat/aiChatHelpers";
import { truncateMarkedBatch } from "@/lib/markerBatch";

export type TranslateStatus = "loading" | "ready" | "error" | "no-provider";

export interface TranslateJob {
  articleTranslation: string;
  articleStatus: TranslateStatus;
  articleError: string;
  /** True once a retry with a shorter body succeeded — small local models with a tiny
   *  context window (e.g. 4k tokens) can't take a full article/comment thread in one go. */
  articleTruncated: boolean;
  commentsTranslation: string;
  commentsStatus: TranslateStatus;
  commentsError: string;
  commentsTruncated: boolean;
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

// Local models often run with a small context window (4k/8k tokens) — retry
// progressively shorter instead of just failing, same budgets as useLearnArticle.
const CHAR_BUDGETS = [Infinity, 6000, 2500];

/** Streams a translation, retrying with a shorter `body` (per CHAR_BUDGETS) whenever the
 *  provider reports the request overflowed the model's context window. `buildBody` gets the
 *  char budget and must produce the text to send — callers truncate however is safe for
 *  their content (plain slice for prose, whole-item drops for marker-delimited batches). */
async function translateWithRetry(
  provider: AIProvider,
  buildBody: (maxChars: number) => string,
  opts: { preserveMarkers?: boolean },
  onChunk: (acc: string) => void
): Promise<{ truncated: boolean }> {
  for (let i = 0; i < CHAR_BUDGETS.length; i++) {
    const body = buildBody(CHAR_BUDGETS[i]);
    try {
      let acc = "";
      for await (const chunk of provider.translate({ text: body, targetLang: "Chinese", mode: "translate", preserveMarkers: opts.preserveMarkers })) {
        acc += chunk;
        onChunk(acc);
      }
      return { truncated: i > 0 };
    } catch (e) {
      const isLastAttempt = i === CHAR_BUDGETS.length - 1;
      if (!isContextOverflowError(e) || isLastAttempt) throw e;
      onChunk(""); // clear the partial stream before retrying with a shorter body
    }
  }
  throw new Error("unreachable");
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
        articleTruncated: false,
        commentsTranslation: "",
        commentsStatus: hasComments ? "loading" : "ready",
        commentsError: "",
        commentsTruncated: false,
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
      const { truncated } = await translateWithRetry(
        provider,
        (maxChars) => (maxChars === Infinity ? articleText : articleText.slice(0, maxChars)),
        {},
        (acc) => patchJob({ articleTranslation: acc })
      );
      patchJob({ articleStatus: "ready", articleTruncated: truncated });
    } catch (e) {
      patchJob({ articleStatus: "error", articleError: errorMessage(e) });
    }
  })();

  if (hasComments) {
    (async () => {
      try {
        // preserveMarkers: commentsText is a batch of @@id@@-delimited comment segments
        // (see lib/hnComments.ts's serializeCommentsForTranslation) — the modal splits
        // the result back apart by those markers to re-render each comment individually.
        // truncateMarkedBatch (rather than a plain slice) drops whole trailing comments
        // instead of cutting a marker in half, which would silently lose that comment.
        const { truncated } = await translateWithRetry(
          provider,
          (maxChars) => (maxChars === Infinity ? commentsText! : truncateMarkedBatch(commentsText!, maxChars)),
          { preserveMarkers: true },
          (acc) => patchJob({ commentsTranslation: acc })
        );
        patchJob({ commentsStatus: "ready", commentsTruncated: truncated });
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
