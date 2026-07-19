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
  const sheetRef = useRef<HTMLTextAreaElement | null>(null);
  const wordCount = useMemo(() => text.trim() ? text.trim().split(/\s+/).length : 0, [text]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, compact ? 160 : 240)}px`;
  }, [text, compact]);

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
        originalText: candidate.original, inputType: "sentence", detectedGenre: "", overallFeedback: "",
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

  const saveAll = async () => {
    if (!result?.candidates.length) return;
    try {
      await invoke("db_save_writing_submission", { input: {
        originalText: text.trim(), inputType: result.candidates.length > 1 ? "essay" : "sentence", detectedGenre: "", overallFeedback: result.analysis || "",
        refinedFullText: result.refinedText, structureFeedback: "", coherenceFeedback: "", toneFeedback: "",
        sentences: result.candidates.map((candidate) => ({ original: candidate.original, corrected: candidate.refined, natural: candidate.refined, explanation: candidate.explanation, vocabulary: [] })),
        modelEssays: result.modelEssays,
      } });
      setSavedCandidates(new Set(result.candidates.map((_, index) => index)));
      toast.success(t("writing.savedAll"));
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

  return <div className="h-full min-h-0 overflow-y-auto">
    <div className={`mx-auto max-w-3xl px-5 ${compact ? "py-4" : "py-7 md:px-8"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex gap-5">
          {(["quick", "deep"] as const).map((value) => <button key={value} onClick={() => setMode(value)} className={`border-b-2 pb-1 text-xs font-semibold transition ${mode === value ? "border-ink text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t(`writing.${value}`)}</button>)}
        </div>
        <p className="text-[11px] text-muted-foreground/80">{t(`writing.${mode}Hint`)}</p>
      </div>

      <div className="mt-4 rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
        <textarea ref={sheetRef} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("writing.placeholder")}
          className="block w-full resize-none overflow-hidden bg-transparent px-6 pb-4 pt-6 font-manuscript text-[17px] leading-8 outline-none placeholder:italic placeholder:text-muted-foreground/40" />
        <div className="flex flex-wrap items-center gap-3 border-t border-border/50 px-5 py-3">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{t("writing.words", { count: wordCount })}</span>
          {mode === "deep" && <><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="accent-[hsl(var(--ink))]" checked={essayCount > 0} onChange={(event) => setEssayCount(event.target.checked ? 1 : 0)} />{t("writing.modelEssay")}</label>{essayCount > 0 && <select value={essayCount} onChange={(event) => setEssayCount(Number(event.target.value))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs"><option value={1}>{t("writing.essayCount", { count: 1 })}</option><option value={2}>{t("writing.essayCount", { count: 2 })}</option></select>}</>}
          <div className="flex-1" />
          {loading && <Button variant="ghost" onClick={() => { abortRef.current?.abort(); setLoading(false); }} className="h-9 px-3 text-xs">{t("writing.stop")}</Button>}
          <Button onClick={run} disabled={loading || !text.trim()} className="h-9 rounded-full px-5 text-xs font-semibold">{loading ? t("writing.analyzing") : result ? t("writing.analyzeAgain") : t("writing.analyze")}</Button>
        </div>
      </div>

      {!result && !loading && !compact && <p className="mt-7 text-center text-xs text-muted-foreground/60">{t("writing.emptyHint")}</p>}

      {loading && <div className="flex min-h-48 flex-col items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink/20 border-t-[hsl(var(--ink))] motion-reduce:animate-none" />
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">{t("writing.progress", { count: progress.length })}</p>
      </div>}

      {result && <div className="mt-10 space-y-10 pb-12 animate-fade-in">
        <section>
          <SectionLabel text={t("writing.refined")} />
          <p className="mt-3 whitespace-pre-wrap rounded-xl bg-card p-5 font-manuscript text-[16px] leading-8 shadow-sm ring-1 ring-border/60">{result.refinedText}</p>
        </section>

        {result.analysis && <section>
          <SectionLabel text={t("writing.analysis")} />
          <div className="mt-3 text-sm leading-7"><Markdown text={result.analysis} /></div>
        </section>}

        <section>
          <div className="flex items-center justify-between gap-4">
            <SectionLabel text={t("writing.candidates")} />
            {result.candidates.length > 0 && <Button variant="outline" disabled={result.candidates.every((_, index) => savedCandidates.has(index))} onClick={saveAll} className="h-7 rounded-full px-3 text-[11px]">{result.candidates.every((_, index) => savedCandidates.has(index)) ? t("writing.collectedAll") : t("writing.collectAll")}</Button>}
          </div>
          <div className="mt-5 space-y-7">
            {result.candidates.map((candidate, index) => <div key={`${candidate.original}-${index}`} className="border-l-2 border-ink/40 pl-5">
              <p className="font-manuscript text-[15px] leading-7 text-muted-foreground line-through decoration-ink/60">{candidate.original}</p>
              <p className="mt-1.5 font-manuscript text-[15px] leading-7">{candidate.refined}</p>
              {candidate.explanation && <p className="mt-2.5 text-xs leading-6 text-muted-foreground"><span className="mr-1.5 font-bold text-ink">※</span>{candidate.explanation}</p>}
              <Button variant="outline" disabled={savedCandidates.has(index)} onClick={() => saveCandidate(candidate, index)} className="mt-3 h-7 rounded-full px-3 text-[11px]">{savedCandidates.has(index) ? t("writing.collected") : t("writing.collect")}</Button>
            </div>)}
          </div>
          {!showCustomSentence ? <Button variant="ghost" onClick={() => setShowCustomSentence(true)} className="mt-4 h-8 px-2 text-xs text-ink hover:text-ink">+ {t("writing.addCustomSentence")}</Button> : <div className="mt-4 space-y-2 rounded-xl bg-card p-3 ring-1 ring-border/60"><textarea value={customSentence.original} onChange={(e) => setCustomSentence({ ...customSentence, original: e.target.value })} placeholder={t("writing.originalSentence")} className="min-h-16 w-full resize-y rounded-lg border border-input bg-background p-3 font-manuscript text-xs" /><textarea value={customSentence.refined} onChange={(e) => setCustomSentence({ ...customSentence, refined: e.target.value })} placeholder={t("writing.refinedSentence")} className="min-h-16 w-full resize-y rounded-lg border border-input bg-background p-3 font-manuscript text-xs" /><input value={customSentence.explanation} onChange={(e) => setCustomSentence({ ...customSentence, explanation: e.target.value })} placeholder={t("writing.explanation")} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs" /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowCustomSentence(false)} className="h-8 text-xs">{t("writing.cancel")}</Button><Button disabled={!customSentence.original.trim() || !customSentence.refined.trim()} onClick={addCustomSentence} className="h-8 text-xs">{t("writing.collect")}</Button></div></div>}
        </section>

        <section>
          <SectionLabel text={t("writing.vocabulary")} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {result.vocabulary.map((item, index) => <div key={`${item.word}-${index}`} className="flex flex-col rounded-xl bg-card p-4 shadow-sm ring-1 ring-border/60">
              <div className="flex items-baseline gap-2">
                <b className="font-manuscript text-[15px]">{item.word}</b>
                {item.level && <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold text-ink">{item.level}</span>}
                <span className="min-w-0 truncate text-xs text-muted-foreground">{item.meaning}</span>
              </div>
              <p className="mt-2 font-manuscript text-xs italic leading-5">{item.exampleSentence}</p>
              {item.reason && <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{item.reason}</p>}
              <div className="flex-1" />
              <Button variant="outline" disabled={savedVocabulary.has(index)} onClick={() => addVocabulary(item, index)} className="mt-3 h-7 self-start rounded-full px-3 text-[11px]">{savedVocabulary.has(index) ? t("writing.vocabAdded") : t("writing.addVocab")}</Button>
            </div>)}
          </div>
          {!showCustomVocab ? <Button variant="ghost" onClick={() => setShowCustomVocab(true)} className="mt-4 h-8 px-2 text-xs text-ink hover:text-ink">+ {t("writing.addCustomVocab")}</Button> : <div className="mt-4 rounded-xl bg-card p-3 ring-1 ring-border/60"><div className="flex gap-2"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input autoFocus value={customVocab} onChange={(e) => setCustomVocab(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addCustomVocabulary(); }} placeholder={t("writing.searchVocab")} className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus:ring-1 focus:ring-ring" /></label><Button disabled={!customVocab.trim()} onClick={addCustomVocabulary} className="h-9 text-xs">{t("writing.addVocab")}</Button><Button variant="ghost" onClick={() => { setShowCustomVocab(false); setCustomVocab(""); }} className="h-9 px-2 text-xs">{t("writing.cancel")}</Button></div></div>}
        </section>

        {result.modelEssays.length > 0 && <section>
          <SectionLabel text={t("writing.modelEssays")} />
          <div className="mt-4 space-y-2">
            {result.modelEssays.map((essay, index) => <details key={index} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border/60">
              <summary className="cursor-pointer text-xs font-semibold">{t("writing.modelEssay")} {index + 1}</summary>
              <p className="mt-3 whitespace-pre-wrap font-manuscript text-[15px] leading-8">{essay}</p>
            </details>)}
          </div>
        </section>}
      </div>}
    </div>
  </div>;
}

function SectionLabel({ text }: { text: string }) {
  return <p className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink"><span className="h-px w-5 bg-ink/60" />{text}</p>;
}
