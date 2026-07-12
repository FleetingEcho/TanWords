import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { gradePracticeSentence, splitPracticeFeedback } from "@/providers/patternAnalysis";
import { Markdown } from "@/components/AiChat/Markdown";
import type { PracticeRecord } from "@/hooks/useDB.types";
import { toast } from "sonner";

const VERDICT_CHIP: Record<string, { label: string; color: string }> = {
  good: { label: "✓", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400" },
  okay: { label: "△", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-400" },
  wrong: { label: "✗", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-400" },
};

interface Props {
  patternId: number;
  pattern: string;
  zh: string;
}

export function PracticeSection({ patternId, pattern, zh }: Props) {
  const t = useT();
  const db = useDB();

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<PracticeRecord[]>([]);
  const [grading, setGrading] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    const list = await db.getPractice(patternId);
    setHistory(list);
  }, [db, patternId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Abort on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleSubmit = async () => {
    const sentence = input.trim();
    if (!sentence || grading) return;

    setGrading(true);
    setStreamingOutput("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let full = "";
      for await (const chunk of gradePracticeSentence(
        pattern,
        zh,
        sentence,
        controller.signal
      )) {
        full += chunk;
        const { body } = splitPracticeFeedback(full);
        setStreamingOutput(body);
      }

      const { verdict, body } = splitPracticeFeedback(full);
      await db.addPractice(patternId, sentence, verdict, body);
      setInput("");
      await loadHistory();
      toast.success(verdict === "good" ? t("patterns.practice.good") : t("patterns.practice.recorded"));
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast.error(t("patterns.practice.failed"));
      }
    } finally {
      setGrading(false);
      setStreamingOutput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSaveAsExample = async (sentence: string) => {
    await db.addPatternExample(patternId, sentence, t("patterns.practice.source"), undefined);
    toast.success(t("patterns.exampleAdded"));
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Input area */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">{t("patterns.practice.title")}</h3>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={grading}
          placeholder={t("patterns.practice.placeholder")}
          className="w-full min-h-[72px] max-h-[160px] px-3 py-2 rounded-lg border border-input bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-muted-foreground">
            {t("patterns.practice.shortcut")}
          </span>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || grading}
            className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {grading ? t("patterns.analyzing") : t("patterns.practice.submit")}
          </button>
        </div>

        {/* Streaming feedback */}
        {streamingOutput && (
          <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border">
            <Markdown text={streamingOutput} />
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {t("patterns.practice.history")} ({history.length})
          </h4>
          {history.map((rec) => {
            const chip = VERDICT_CHIP[rec.verdict] ?? VERDICT_CHIP.okay;
            const isOpen = expanded.has(rec.id);
            return (
              <div key={rec.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${chip.color}`}>
                    {chip.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{rec.sentence}</p>
                    {isOpen && (
                      <div className="mt-2 prose prose-sm max-w-none dark:prose-invert">
                        <Markdown text={rec.feedback} />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => toggleExpand(rec.id)}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        {isOpen ? t("patterns.practice.collapse") : t("patterns.practice.expand")}
                      </button>
                      {rec.verdict === "good" && !rec.saved && (
                        <button
                          onClick={() => {
                            handleSaveAsExample(rec.sentence);
                            rec.saved = true;
                          }}
                          className="text-[10px] text-primary hover:underline"
                        >
                          {t("patterns.practice.saveAsExample")}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          await db.deletePractice(rec.id);
                          loadHistory();
                        }}
                        className="text-[10px] text-muted-foreground hover:text-destructive ml-auto"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
