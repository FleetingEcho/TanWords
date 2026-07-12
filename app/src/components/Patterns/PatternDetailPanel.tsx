import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, PatternDetail, PatternTag } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { Markdown } from "@/components/AiChat/Markdown";
import { analyzePattern, splitPatternAnalysis } from "@/providers/patternAnalysis";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { PracticeSection } from "./PracticeSection";

/** Render a pattern skeleton with X/Y/Z slots as visible amber "slot" chips. */
export function PatternSlots({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/(\b[XYZ]\b)/);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        /^[XYZ]$/.test(p) ? (
          <span
            key={i}
            className="inline-flex items-center justify-center min-w-[1.4em] px-1 mx-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-dashed border-amber-500/50 font-bold"
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}

export function TagChip({ tag }: { tag: PatternTag }) {
  const t = useT();
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0">
      {t(`patterns.tag.${tag}`)}
    </span>
  );
}

export function PatternDetailPanel({
  detail,
  onChanged,
  onDeleted,
}: {
  detail: PatternDetail;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const db = useDB();
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  const setPendingArticleId = useReadingStore((s) => s.setPendingArticleId);

  const [analyzing, setAnalyzing] = useState(false);
  const [streamText, setStreamText] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  // Cancel any in-flight analysis when switching patterns / unmounting
  useEffect(() => {
    setAnalyzing(false);
    setStreamText("");
    controllerRef.current?.abort();
    return () => controllerRef.current?.abort();
  }, [detail.id]);

  const runAnalysis = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setAnalyzing(true);
    setStreamText("");
    let full = "";
    try {
      const examples = detail.examples.map((e) => e.sentence);
      for await (const chunk of analyzePattern(detail.pattern, detail.zh, examples, controller.signal)) {
        if (controller.signal.aborted) return;
        full += chunk;
        setStreamText(splitPatternAnalysis(full).body);
      }
      const { tag, body } = splitPatternAnalysis(full);
      await db.savePatternAnalysis(detail.id, body, tag);
      toast.success(t("patterns.analyzed"));
      onChanged();
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast.error(e.message || t("patterns.analyzeFailed"));
    } finally {
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t("patterns.deleteConfirm"))) return;
    await db.deletePattern(detail.id);
    onDeleted();
  };

  const openArticle = (articleId: number) => {
    setPendingArticleId(articleId);
    navigate("reading");
  };

  const analysisText = analyzing || streamText ? streamText : detail.analysis;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-bold leading-relaxed flex items-start gap-1.5">
            <PatternSlots text={detail.pattern} />
            <SpeakButton text={detail.pattern.replace(/\b[XYZ]\b/g, "something")} className="w-4 h-4 mt-1.5" />
          </p>
          <button
            onClick={handleDelete}
            className="text-[11px] text-muted-foreground/60 hover:text-destructive transition-colors shrink-0 mt-1"
          >
            {t("patterns.delete")}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <TagChip tag={detail.function_tag} />
          <LevelBadge level={detail.level} />
          <span className="text-sm text-muted-foreground">{detail.zh}</span>
        </div>
        {detail.note && (
          <p className="text-xs text-muted-foreground leading-relaxed mt-2.5 pt-2.5 border-t border-border">
            {detail.note}
          </p>
        )}
      </div>

      {/* Real examples from articles */}
      {detail.examples.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-semibold">{t("patterns.examples")}</span>
            <span className="text-[11px] font-mono text-muted-foreground">{detail.examples.length}</span>
          </div>
          <div className="divide-y divide-border">
            {detail.examples.map((ex) => (
              <div key={ex.id} className="px-4 py-3 space-y-1">
                <p className="text-sm leading-relaxed flex items-start gap-1.5">
                  <span>“{ex.sentence}”</span>
                  <SpeakButton text={ex.sentence} className="w-3.5 h-3.5 mt-0.5" />
                </p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{ex.source}</span>
                  {ex.article_id !== null && (
                    <button
                      onClick={() => openArticle(ex.article_id!)}
                      className="font-semibold text-primary hover:underline shrink-0"
                    >
                      {t("patterns.viewArticle")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI analysis */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-primary">✦</span>
            <span className="text-xs font-semibold">{t("patterns.analysis")}</span>
          </div>
          {detail.analysis && !analyzing && (
            <button onClick={runAnalysis} className="text-[11px] font-semibold text-primary hover:underline">
              {t("patterns.reanalyze")}
            </button>
          )}
        </div>
        <div className="p-4">
          {analysisText ? (
            <>
              <Markdown text={analysisText} />
              {analyzing && <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />}
            </>
          ) : (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                {t("patterns.analysisEmpty")}
              </p>
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {analyzing ? t("patterns.analyzing") : `✦ ${t("patterns.analyze")}`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Production practice (造句练习) */}
      <PracticeSection
        patternId={detail.id}
        pattern={detail.pattern}
        zh={detail.zh}
      />
    </div>
  );
}
