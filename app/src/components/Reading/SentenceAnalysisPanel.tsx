import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { Markdown } from "@/components/AiChat/Markdown";
import { analyzeSentence, extractSentencePattern } from "@/providers/patternAnalysis";
import { SpeakButton } from "@/components/ui/SpeakButton";

/**
 * Right-rail close-reading panel: streams an AI breakdown of the clicked
 * sentence; once complete, the parsed pattern skeleton (or the raw sentence
 * as fallback) can be saved into the pattern library.
 */
export function SentenceAnalysisPanel({
  sentence,
  articleTitle,
  articleId,
  onClose,
}: {
  sentence: string;
  articleTitle: string;
  articleId: number;
  onClose: () => void;
}) {
  const db = useDB();
  const t = useT();
  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(true);
  const [saved, setSaved] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setText("");
    setSaved(false);
    setAnalyzing(true);

    (async () => {
      try {
        let full = "";
        for await (const chunk of analyzeSentence(sentence, articleTitle, controller.signal)) {
          if (controller.signal.aborted) return;
          full += chunk;
          setText(full);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") toast.error(e.message || t("patterns.analyzeFailed"));
      } finally {
        if (!controller.signal.aborted) setAnalyzing(false);
      }
    })();

    return () => controller.abort();
  }, [sentence]);

  const savePattern = async () => {
    const parsed = extractSentencePattern(text);
    const id = await db.addPattern({
      pattern: parsed?.pattern ?? sentence,
      zh: parsed?.zh ?? "",
      example: { sentence, source: articleTitle, articleId },
    });
    if (id === null) return; // wrapper already toasted
    setSaved(true);
    window.dispatchEvent(new CustomEvent("patterns-updated"));
    toast.success(t("reading.sentence.saved"));
  };

  return (
    <div className="bg-card border border-primary/30 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-primary shrink-0">✦</span>
          <span className="text-xs font-semibold shrink-0">{t("reading.sentence.title")}</span>
        </div>
        <button
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {t("reading.sentence.close")}
        </button>
      </div>

      <p className="px-4 pt-3 text-xs italic text-muted-foreground leading-relaxed line-clamp-3 flex items-start gap-1.5">
        <span>“{sentence}”</span>
        <SpeakButton text={sentence} className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      </p>

      <div className="p-4">
        {text ? (
          <>
            <Markdown text={text} />
            {analyzing && <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />}
          </>
        ) : (
          <p className="text-xs text-muted-foreground animate-pulse">{t("reading.sentence.analyzing")}</p>
        )}
      </div>

      {!analyzing && text && (
        <div className="px-4 pb-3">
          {saved ? (
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ {t("reading.sentence.saved")}
            </span>
          ) : (
            <button
              onClick={savePattern}
              className="h-8 px-4 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/20 transition-colors"
            >
              {t("reading.sentence.save")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
