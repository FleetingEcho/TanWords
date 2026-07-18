import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { WordDetailPanel } from "@/components/Vocabulary/WordDetailPanel";
import { analyzeSentence, type SentenceAnalysis } from "@/features/knowledge-map/generator";
import type { NewKnowledgeNode } from "@/features/knowledge-map/types";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { parseEnrichmentStream, type ParsedEnrichment } from "@/lib/enrichMeta";
import { findBestProvider } from "@/providers/select";

function notifyVocabUpdated() { window.dispatchEvent(new CustomEvent("vocab-updated")); }

/** Instant dictionary lookup for a single word — streams the enrichment. */
export function WordAnalysis({ word, onExpandTopic }: { word: string; onExpandTopic: (label: string) => void }) {
  const db = useDB();
  const t = useT();
  const [enriched, setEnriched] = useState<ParsedEnrichment | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState("");
  const [wordId, setWordId] = useState<number | null>(null);

  const enrich = useCallback(async (signal?: AbortSignal) => {
    const provider = findBestProvider();
    if (!provider) { setError(t("modal.noProvider")); return; }
    setError("");
    setEnriched(null);
    setEnriching(true);
    let raw = "";
    try {
      for await (const chunk of provider.enrich(word, signal)) {
        if (signal?.aborted) return;
        raw += chunk;
        setEnriched(parseEnrichmentStream(raw));
      }
    } catch (reason: any) {
      if (reason?.name !== "AbortError") setError(reason?.message || t("modal.noProvider"));
    } finally {
      if (!signal?.aborted) setEnriching(false);
    }
  }, [word, t]);

  useEffect(() => {
    setWordId(null);
    const controller = new AbortController();
    void enrich(controller.signal);
    return () => controller.abort();
  }, [word, enrich]);

  const add = async () => {
    if (wordId || !enriched?.text.trim()) return;
    const { id } = await db.addWordEnriched(word, enriched.zhShort || word, null, { text: enriched.text, zhShort: enriched.zhShort, level: enriched.level });
    if (id) {
      setWordId(id);
      notifyVocabUpdated();
      toast.success(t("knowledgeMap.wordAdded"));
    }
  };

  return <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-6">
    <div className="mb-3 flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-[.18em] text-primary">{t("knowledgeMap.wordAnalysisTitle")}</span>
      <button onClick={() => onExpandTopic(word)} className="text-xs font-medium text-primary hover:underline">{t("knowledgeMap.expandAsTopic")} →</button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border">
      <WordDetailPanel
        selected={{ word, zh: enriched?.zhShort || null, wordType: null, level: enriched?.level || null, ipa: "" }}
        wordId={wordId}
        enriched={enriched}
        enriching={enriching}
        enrichError={error}
        legacy={false}
        notes=""
        lookupMode
        lookupAdded={Boolean(wordId)}
        onAddToVocab={() => void add()}
        onNotesChange={() => {}}
        onClearNotes={() => {}}
        onRetry={() => void enrich()}
        onReenrich={() => void enrich()}
      />
    </div>
  </div>;
}

/** Instant breakdown of a full sentence: translation, learnable pieces, pattern. */
export function SentenceAnalysisView({ sentence, levels, onExpandTopic }: { sentence: string; levels: string; onExpandTopic: (label: string) => void }) {
  const db = useDB();
  const t = useT();
  const [result, setResult] = useState<SentenceAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [sentenceSaved, setSentenceSaved] = useState(false);

  useEffect(() => {
    const provider = findBestProvider();
    if (!provider) { setError(t("modal.noProvider")); return; }
    const controller = new AbortController();
    setResult(null);
    setError("");
    setAdded(new Set());
    setSentenceSaved(false);
    setBusy(true);
    analyzeSentence(provider, sentence, levels, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setResult(value); })
      .catch((reason: any) => { if (reason?.name !== "AbortError" && !controller.signal.aborted) setError(reason?.message || t("knowledgeMap.analyzeFailed")); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [sentence, levels, t]);

  const addItem = async (index: number, item: NewKnowledgeNode) => {
    if (added.has(index)) return;
    const { id } = await db.addWordEnriched(item.label, item.zh || item.label, null, { text: item.note, zhShort: item.zh, level: item.level });
    if (id) {
      setAdded((current) => new Set(current).add(index));
      notifyVocabUpdated();
      toast.success(t("knowledgeMap.wordAdded"));
    }
  };

  const saveSentence = async () => {
    if (!result || sentenceSaved) return;
    const saved = await db.saveSentencePattern(sentence, result.translation, result.skeleton, result.pattern, "", "sentence-analysis");
    if (saved) {
      setSentenceSaved(true);
      toast.success(t("knowledgeMap.sentenceSaved"));
    }
  };

  return <div className="mx-auto max-w-3xl px-6 py-6">
    <span className="text-xs font-bold uppercase tracking-[.18em] text-primary">{t("knowledgeMap.sentenceAnalysisTitle")}</span>
    <div className="mt-3 rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-serif text-lg leading-relaxed">{sentence}</p>
        <SpeakButton text={sentence} className="mt-1.5 h-4 w-4 shrink-0" />
      </div>
      {busy && <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />{t("knowledgeMap.analyzing")}
      </div>}
      {error && !busy && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {result && <>
        <p className="mt-2 text-muted-foreground">{result.translation}</p>

        {!!result.items.length && <div className="mt-5">
          <p className="mb-2 text-xs font-bold text-muted-foreground">{t("knowledgeMap.breakdown")}</p>
          <div className="space-y-1.5">
            {result.items.map((item, index) => <div key={index} className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <strong className="min-w-0 break-words font-serif text-[15px]">{item.label}</strong>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{item.zh}</span>
                </span>
                {item.note && <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{item.note}</span>}
              </div>
              {item.level && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{item.level}</span>}
              <SpeakButton text={item.label} className="h-4 w-4 shrink-0" />
              <button
                disabled={added.has(index)}
                onClick={() => void addItem(index, item)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition ${added.has(index) ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}
              >{added.has(index) ? "✓" : "+"}</button>
            </div>)}
          </div>
        </div>}

        {result.pattern && <div className="mt-5 rounded-xl bg-muted/50 p-3 text-sm leading-6">
          <span className="mr-2 text-xs font-bold text-muted-foreground">{t("knowledgeMap.pattern")}</span>{result.pattern}
        </div>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={sentenceSaved} onClick={() => void saveSentence()}>{sentenceSaved ? t("knowledgeMap.sentenceSavedLabel") : t("knowledgeMap.saveSentence")}</Button>
          {!!result.related.length && <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("knowledgeMap.relatedTopics")}</span>
            {result.related.map((topic) => <button key={topic} onClick={() => onExpandTopic(topic)} className="rounded-full border px-3 py-1 text-xs transition hover:border-primary/50 hover:text-primary">{topic}</button>)}
          </div>}
        </div>
      </>}
    </div>
  </div>;
}
