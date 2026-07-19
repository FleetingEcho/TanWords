import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/AiChat/Markdown";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { analyzeWriting } from "@/features/writing/ai";
import type { WritingCandidate, WritingMode, WritingResponse, WritingSuggestion } from "@/features/writing/types";

const MODE_KEY = "tanwords.writing.mode";

export function WritingAnalyzer({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const t = useT();
  const db = useDB();
  const uiLanguage = useSettingsStore((state) => state.uiLanguage);
  const [mode, setModeState] = useState<WritingMode>(() => localStorage.getItem(MODE_KEY) === "deep" ? "deep" : "quick");
  const [text, setText] = useState("");
  const [result, setResult] = useState<WritingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [essayCount, setEssayCount] = useState(0);
  const [savedCandidates, setSavedCandidates] = useState<Set<number>>(new Set());
  const [savedVocabulary, setSavedVocabulary] = useState<Set<number>>(new Set());
  const [showCustomVocab, setShowCustomVocab] = useState(false);
  const [showCustomSentence, setShowCustomSentence] = useState(false);
  const [customSentence, setCustomSentence] = useState({ original: "", refined: "", explanation: "" });
  const [customVocab, setCustomVocab] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const wordCount = useMemo(() => text.trim() ? text.trim().split(/\s+/).length : 0, [text]);

  useEffect(() => {
    const syncMode = (event: Event) => {
      const next = (event as CustomEvent<WritingMode>).detail;
      setModeState(next);
      if (next === "quick") setEssayCount(0);
    };
    window.addEventListener("writing-mode-changed", syncMode);
    return () => window.removeEventListener("writing-mode-changed", syncMode);
  }, []);

  const setMode = (next: WritingMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
    window.dispatchEvent(new CustomEvent("writing-mode-changed", { detail: next }));
    if (next === "quick") setEssayCount(0);
  };

  const run = async () => {
    if (!text.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true); setResult(null); setProgress(""); setSavedCandidates(new Set()); setSavedVocabulary(new Set());
    try {
      setResult(await analyzeWriting(text.trim(), mode, mode === "deep" ? essayCount : 0, uiLanguage === "en" ? "en" : "zh", controller.signal, setProgress));
    } catch (error) {
      if (!controller.signal.aborted) toast.error(String(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const saveCandidate = async (candidate: WritingCandidate, index: number) => {
    if (index >= 0 && savedCandidates.has(index)) return;
    try {
      await invoke("db_save_writing_submission", { input: {
        originalText: candidate.original, inputType: "saved", detectedGenre: "", overallFeedback: "",
        refinedFullText: candidate.refined, structureFeedback: "", coherenceFeedback: "", toneFeedback: "",
        sentences: [{ original: candidate.original, corrected: candidate.refined, natural: candidate.refined, explanation: candidate.explanation, vocabulary: [] }],
        modelEssays: [],
      } });
      if (index >= 0) setSavedCandidates((old) => new Set(old).add(index));
      toast.success(t("writing.savedSentence"));
      window.dispatchEvent(new CustomEvent("writing-updated"));
      onSaved?.();
    } catch (error) { toast.error(t("writing.saveFailed", { error: String(error) })); }
  };

  const addVocabulary = async (item: WritingSuggestion, index?: number) => {
    if (index !== undefined && savedVocabulary.has(index)) return;
    try {
      const response = await db.addWordsBatch([{ word: item.word, zh: item.meaning, context: item.exampleSentence }], "writing");
      if (response.added > 0) {
        if (index !== undefined) setSavedVocabulary((old) => new Set(old).add(index));
        toast.success(t("writing.vocabSaved"));
        window.dispatchEvent(new CustomEvent("vocab-updated"));
      } else toast.info(t("writing.alreadyExists", { word: item.word }));
    } catch (error) { toast.error(t("writing.saveFailed", { error: String(error) })); }
  };

  const addCustomVocabulary = async () => {
    const word = customVocab.trim();
    if (!word) return toast.error(t("writing.invalidCustomVocab"));
    const existing = await db.getWordDetailByWord(word);
    if (existing) return toast.info(t("writing.alreadyExists", { word }));
    const response = await db.addWord(word, "");
    if (!response.isNew) return toast.info(t("writing.alreadyExists", { word }));
    setCustomVocab("");
    setShowCustomVocab(false);
    toast.success(t("writing.vocabSaved"));
    window.dispatchEvent(new CustomEvent("vocab-updated"));
  };

  const addCustomSentence = async () => {
    if (!customSentence.original.trim() || !customSentence.refined.trim()) return;
    await saveCandidate({ original: customSentence.original.trim(), refined: customSentence.refined.trim(), explanation: customSentence.explanation.trim() }, -1);
    setCustomSentence({ original: "", refined: "", explanation: "" });
    setShowCustomSentence(false);
  };

  return <div className={`h-full min-h-0 ${compact ? "flex flex-col overflow-y-auto" : "grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.9fr)]"}`}>
    <section className="flex min-h-0 flex-col bg-background lg:border-r lg:border-border/70">
      <div className="px-5 pt-4">
        <div className="grid grid-cols-2 rounded-xl bg-muted/70 p-1">
          {(["quick", "deep"] as const).map((value) => <button key={value} onClick={() => setMode(value)} className={`rounded-lg px-3 py-2 text-left transition ${mode === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <span className="block text-xs font-semibold">{t(`writing.${value}`)}</span><span className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">{t(`writing.${value}Hint`)}</span>
          </button>)}
        </div>
      </div>
      <div className="flex items-center justify-between px-6 pb-2 pt-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("writing.yourWriting")}</p><p className="mt-1 text-xs text-muted-foreground/70">{t("writing.inputHint")}</p></div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] tabular-nums text-muted-foreground">{t("writing.words", { count: wordCount })}</span>
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t("writing.placeholder")} className={`min-h-0 flex-1 resize-none bg-transparent px-6 py-4 text-[16px] leading-8 outline-none placeholder:text-muted-foreground/35 ${compact ? "min-h-52" : ""}`} />
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-5 py-3">
        {mode === "deep" && <><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={essayCount > 0} onChange={(event) => setEssayCount(event.target.checked ? 1 : 0)} />{t("writing.modelEssay")}</label>{essayCount > 0 && <select value={essayCount} onChange={(event) => setEssayCount(Number(event.target.value))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs"><option value={1}>{t("writing.essayCount", { count: 1 })}</option><option value={2}>{t("writing.essayCount", { count: 2 })}</option></select>}</>}
        <div className="flex-1" />
        {loading && <Button variant="ghost" onClick={() => { abortRef.current?.abort(); setLoading(false); }} className="h-9 px-3 text-xs">{t("writing.stop")}</Button>}
        <Button onClick={run} disabled={loading || !text.trim()} className="h-9 rounded-lg px-5 text-xs font-semibold">{loading ? t("writing.analyzing") : result ? t("writing.analyzeAgain") : t("writing.analyze")}</Button>
      </div>
    </section>

    <section className={`min-h-0 flex-col bg-muted/20 ${compact ? result || loading ? "flex min-h-80" : "hidden" : "flex"}`}>
      <div className="border-b border-border/60 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("writing.result")}</p></div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {!result && !loading && <div className="flex h-full min-h-64 flex-col items-center justify-center text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-xl text-primary">Aa</div><p className="text-sm font-semibold">{t("writing.emptyTitle")}</p><p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">{t("writing.emptyHint")}</p></div>}
        {loading && <div className="flex h-full min-h-64 flex-col items-center justify-center"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary"/><p className="mt-3 text-xs text-muted-foreground">{t("writing.progress", { count: progress.length })}</p></div>}
        {result && <div className="space-y-7">
          <ResultSection title={t("writing.refined")}><p className="whitespace-pre-wrap rounded-xl bg-background p-4 text-sm leading-7 ring-1 ring-border/60">{result.refinedText}</p></ResultSection>
          {result.analysis && <ResultSection title={t("writing.analysis")}><div className="text-sm leading-7"><Markdown text={result.analysis}/></div></ResultSection>}
          <ResultSection title={t("writing.candidates")}><div className="space-y-3">{result.candidates.map((candidate, index) => <div key={`${candidate.original}-${index}`} className="rounded-xl bg-background p-4 ring-1 ring-border/60"><p className="text-xs leading-5 text-muted-foreground line-through decoration-destructive/40">{candidate.original}</p><p className="mt-2 text-sm leading-6">{candidate.refined}</p>{candidate.explanation && <p className="mt-2 text-xs leading-5 text-muted-foreground">{candidate.explanation}</p>}<Button variant="outline" disabled={savedCandidates.has(index)} onClick={() => saveCandidate(candidate, index)} className="mt-3 h-8 px-3 text-[11px]">{savedCandidates.has(index) ? t("writing.collected") : t("writing.collect")}</Button></div>)}</div>
            {!showCustomSentence ? <Button variant="ghost" onClick={() => setShowCustomSentence(true)} className="mt-3 h-8 px-2 text-xs text-primary">+ {t("writing.addCustomSentence")}</Button> : <div className="mt-3 space-y-2 rounded-xl border border-border bg-background p-3"><textarea value={customSentence.original} onChange={(e) => setCustomSentence({ ...customSentence, original: e.target.value })} placeholder={t("writing.originalSentence")} className="min-h-16 w-full resize-y rounded-lg border border-input bg-background p-3 text-xs"/><textarea value={customSentence.refined} onChange={(e) => setCustomSentence({ ...customSentence, refined: e.target.value })} placeholder={t("writing.refinedSentence")} className="min-h-16 w-full resize-y rounded-lg border border-input bg-background p-3 text-xs"/><input value={customSentence.explanation} onChange={(e) => setCustomSentence({ ...customSentence, explanation: e.target.value })} placeholder={t("writing.explanation")} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs"/><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowCustomSentence(false)} className="h-8 text-xs">{t("writing.cancel")}</Button><Button disabled={!customSentence.original.trim() || !customSentence.refined.trim()} onClick={addCustomSentence} className="h-8 text-xs">{t("writing.collect")}</Button></div></div>}
          </ResultSection>
          <ResultSection title={t("writing.vocabulary")}><div className="space-y-3">{result.vocabulary.map((item, index) => <div key={`${item.word}-${index}`} className="rounded-xl bg-background p-4 ring-1 ring-border/60"><div className="flex items-baseline gap-2"><b className="text-sm">{item.word}</b>{item.level && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{item.level}</span>}<span className="text-xs text-muted-foreground">{item.meaning}</span></div>{item.reason && <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</p>}<p className="mt-1 text-xs italic leading-5">{item.exampleSentence}</p><Button variant="outline" disabled={savedVocabulary.has(index)} onClick={() => addVocabulary(item, index)} className="mt-3 h-8 px-3 text-[11px]">{savedVocabulary.has(index) ? t("writing.vocabAdded") : t("writing.addVocab")}</Button></div>)}</div>
            {!showCustomVocab ? <Button variant="ghost" onClick={() => setShowCustomVocab(true)} className="mt-3 h-8 px-2 text-xs text-primary">+ {t("writing.addCustomVocab")}</Button> : <div className="mt-3 rounded-xl border border-border bg-background p-3"><div className="flex gap-2"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"/><input autoFocus value={customVocab} onChange={(e) => setCustomVocab(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addCustomVocabulary(); }} placeholder={t("writing.searchVocab")} className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary"/></label><Button disabled={!customVocab.trim()} onClick={addCustomVocabulary} className="h-9 text-xs">{t("writing.addVocab")}</Button><Button variant="ghost" onClick={() => { setShowCustomVocab(false); setCustomVocab(""); }} className="h-9 px-2 text-xs">{t("writing.cancel")}</Button></div></div>}
          </ResultSection>
          {result.modelEssays.length > 0 && <ResultSection title={t("writing.modelEssays")}><div className="space-y-2">{result.modelEssays.map((essay, index) => <details key={index} className="rounded-xl bg-background p-4 ring-1 ring-border/60"><summary className="cursor-pointer text-xs font-semibold">{t("writing.modelEssay")} {index + 1}</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{essay}</p></details>)}</div></ResultSection>}
        </div>}
      </div>
    </section>
  </div>;
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>;
}
