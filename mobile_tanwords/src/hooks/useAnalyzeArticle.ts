/**
 * useAnalyzeArticle — mobile port of the desktop hook's orchestration
 * (app/src/hooks/useAnalyzeArticle.ts): find the best provider, guarantee a key,
 * load exclusion words, stream the extraction, abort support.
 *
 * State is per-hook (not a global store): the mobile UI has a single analyze
 * entry point (the Reading tab), unlike desktop where concurrent background
 * jobs are shared through analysisStore (see the desktop file's long comment).
 */
import { useCallback, useRef, useState } from "react";
import { findBestProvider } from "@/providers/select";
import { areProvidersReady } from "@/providers";
import { initProviders } from "@/providers/providerStore";
import { fetchArticle } from "@/services/readability";
import {
  abortedError,
  loadExcludedWords,
  normalizeAnalyzeError,
  streamExtraction,
  type ExtractionResult,
} from "@/ai/analyze";

export type AnalyzePhase = "idle" | "fetching_url" | "extracting" | "done";

export interface AnalyzeOutcome extends ExtractionResult {
  title: string;
  text: string;
  sourceUrl: string;
  source: string;
}

export interface AnalyzeProgress {
  phase: Exclude<AnalyzePhase, "idle"> | null;
  chars: number;
  words: number;
  patterns: number;
}

const NO_PROGRESS: AnalyzeProgress = { phase: null, chars: 0, words: 0, patterns: 0 };

/** The provider registry starts empty until ai_providers rows + SecureStore
 *  keys are loaded. Nobody else initializes it at app startup yet, so callers
 *  must land here on their first AI use (idempotent; cheap when already done).
 */
export async function ensureProviders(): Promise<void> {
  if (!areProvidersReady()) await initProviders();
}

export function useAnalyzeArticle() {
  const [progress, setProgress] = useState<AnalyzeProgress>(NO_PROGRESS);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const analyze = useCallback(
    async (opts: {
      text: string;
      title?: string | null;
      sourceUrl?: string | null;
      source?: string;
    }): Promise<AnalyzeOutcome> => {
      await ensureProviders();
      const provider = findBestProvider();
      if (!provider) {
        throw new Error("未找到 AI 提供商，请在设置中注册");
      }
      if (!provider.apiKey) {
        throw new Error("未配置 API Key，请在设置 → AI 提供商 中填写");
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        setProgress({ phase: "extracting", chars: 0, words: 0, patterns: 0 });
        const excluded = await loadExcludedWords();
        if (controller.signal.aborted) throw abortedError();
        const result = await streamExtraction(
          provider,
          opts.text,
          excluded,
          controller.signal,
          {
            onChars: (chars) =>
              setProgress((p) => (p.phase === "extracting" ? { ...p, chars } : p)),
            onItem: ({ words, patterns }) =>
              setProgress((p) => (p.phase === "extracting" ? { ...p, words, patterns } : p)),
          }
        );
        if (
          result.words.length === 0 &&
          result.patterns.length === 0 &&
          // A too-short text legitimately yields an empty extraction — the
          // caller validates readability before analyze and shows its own error.
          opts.text.trim().split(/\s+/).length >= 80
        ) {
          throw new Error("模型没有返回可提取的内容，请重试");
        }
        setProgress((p) => ({ ...p, phase: "done" }));
        return {
          ...result,
          title: (opts.title ?? "").trim(),
          text: opts.text,
          sourceUrl: opts.sourceUrl?.trim() ?? "",
          source: opts.source ?? "paste",
        };
      } catch (e) {
        controllerRef.current = null;
        setProgress(NO_PROGRESS);
        if (e instanceof Error && e.name === "AbortError") throw e;
        throw normalizeAnalyzeError(e);
      }
    },
    []
  );

  /** URL flow: fetch + extract body (readability service), then analyze. */
  const analyzeUrl = useCallback(
    async (url: string): Promise<AnalyzeOutcome> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setProgress({ phase: "fetching_url", chars: 0, words: 0, patterns: 0 });
      let article;
      try {
        article = await fetchArticle(url);
      } catch (e) {
        setProgress(NO_PROGRESS);
        if (controller.signal.aborted) throw abortedError();
        throw new Error("网页抓取失败，请直接粘贴正文");
      }
      if (controller.signal.aborted) {
        setProgress(NO_PROGRESS);
        throw abortedError();
      }
      return analyze({
        text: article.textContent,
        title: article.title,
        sourceUrl: article.url || url,
        source: "reader",
      });
    },
    [analyze]
  );

  const reset = useCallback(() => {
    setProgress(NO_PROGRESS);
    controllerRef.current = null;
  }, []);

  const running = progress.phase !== null && progress.phase !== "done";

  return { analyze, analyzeUrl, abort, reset, progress, running };
}
