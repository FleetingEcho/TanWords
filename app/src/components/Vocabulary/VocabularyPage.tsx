import React, { useState, useEffect, useMemo, useRef } from "react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { WordListPanel, LevelValue } from "./WordListPanel";
import { matchesLevels } from "@/components/shared/LevelDateFilter";
import { WordDetailPanel } from "./WordDetailPanel";
import { PatternLibrary } from "./PatternLibrary";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";
import { fetchBasicInfo, BasicInfo } from "@/lib/basicInfo";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useVocabEnrichStore } from "@/store/vocabEnrichStore";

interface SelectedWordData {
  word: WordListItem;
  enriched: ParsedEnrichment | null;
  legacy: boolean;
  notes: string;
}

/** A word looked up via AI that is not (yet) in the vocabulary */
interface LookupData {
  word: string;
  enriched: ParsedEnrichment | null;
  basicInfo: BasicInfo;
  added: boolean;
  wordId: number | null;
}

const PAGE_SIZE = 50;
/** How many words a bulk enrich analyzes concurrently */
const BULK_CONCURRENCY = 3;

export function VocabularyPage({ initialWordId }: { initialWordId?: number }) {
  const db = useDB();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  // Data
  const [words, setWords] = useState<WordListItem[]>([]);
  const [selected, setSelected] = useState<SelectedWordData | null>(null);
  const selectedRef = useRef<SelectedWordData | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [notes, setNotes] = useState("");

  // Filters — levelFilters is applied client-side (empty = all levels) so
  // toggling level chips never needs a DB round-trip.
  const [levelFilters, setLevelFilters] = useState<LevelValue[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"words" | "patterns">("words");
  const [patternSeed, setPatternSeed] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem("vocab-wordlist-collapsed") === "1");
  const toggleListCollapsed = () => setListCollapsed((current) => {
    localStorage.setItem("vocab-wordlist-collapsed", current ? "0" : "1");
    return !current;
  });

  // ── Multi-select (header actions: reanalyze / delete selected) ─────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleWordSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearWordSelection = () => setSelectedIds(new Set());
  const selectAllWords = () => setSelectedIds(new Set(visibleWords.map((w) => w.id)));
  const toggleWordSelectMode = () => {
    setSelectMode((v) => !v);
    clearWordSelection();
  };
  const exitWordSelectMode = () => {
    setSelectMode(false);
    clearWordSelection();
  };
  // Double-click toggles select mode; entering it pre-selects the clicked word.
  const handleWordDoubleClick = (w: WordListItem) => {
    if (selectMode) {
      exitWordSelectMode();
    } else {
      setSelectMode(true);
      setSelectedIds(new Set([w.id]));
    }
  };
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);

  // ── Star / unstar (optimistic — the toggle should feel instant) ────────
  const toggleWordStar = async (id: number) => {
    const target = words.find((w) => w.id === id);
    if (!target) return;
    const next = !target.starred;
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, starred: next } : w)));
    const ok = await db.setWordStarred(id, next);
    if (!ok) setWords((prev) => prev.map((w) => (w.id === id ? { ...w, starred: !next } : w)));
  };
  const [deletingSelected, setDeletingSelected] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Enrichment
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const lookupControllerRef = useRef<AbortController | null>(null);
  const t = useT();

  // Reactive fallback for `enriching`: a single-word re-analyze started before this
  // component (re)mounted — e.g. the user navigated away and back — has no local state
  // to reflect it, but vocabEnrichStore does. Falls back to false once selected is null.
  const selectedWordJobRunning = useVocabEnrichStore(
    (s) => (selected ? s.singleJobs[selected.word.word]?.status === "running" : false)
  );
  const effectiveEnriching = enriching || selectedWordJobRunning;

  // Same idea for the streamed text itself: while a job for the selected word is running,
  // its partial output lives in the store, so selecting another word and coming back shows
  // everything that arrived in between instead of an empty panel.
  const selectedWordJobText = useVocabEnrichStore(
    (s) => (selected ? s.singleTexts[selected.word.word] ?? "" : "")
  );
  const streamingEnriched = useMemo(
    () => (selectedWordJobRunning && selectedWordJobText ? parseEnrichmentStream(selectedWordJobText) : null),
    [selectedWordJobRunning, selectedWordJobText]
  );

  // Deliberately no unmount cleanup that aborts the running enrich/bulk controllers — analysis
  // (single-word or bulk) must keep running in the background even after the user navigates
  // to another page, same as the reader's "Learn" flow. The async functions below aren't
  // tied to this component's lifecycle: once started, they run to completion and persist to
  // the DB regardless of whether VocabularyPage is still mounted to show their progress.

  // ── Bulk enrichment (header buttons: enrich un-analyzed / re-analyze all) ──
  // Progress lives in vocabEnrichStore (not component state) so it survives navigating
  // away mid-run — CommandBar's "Analyzing" indicator reads the same store, so the job
  // stays visible (and cancelable) from anywhere, not just while this page is mounted.

  const bulk = useVocabEnrichStore((s) => s.bulk);
  const bulkRunning = bulk.running;
  const bulkProgress = { done: bulk.done, total: bulk.total };
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false);

  const runBulkEnrich = async (targets: WordListItem[]) => {
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }
    if (targets.length === 0) {
      toast.info(t("vocab.bulkEnrichNoneNeeded"));
      return;
    }

    const controller = useVocabEnrichStore.getState().startBulk(targets.length);

    let succeeded = 0;
    let failed = 0;
    let done = 0;
    let nextIndex = 0;

    const processWord = async (w: WordListItem) => {
      // If this word's detail panel happens to be open, clear its stale
      // explanation and show the loading state while its turn runs. Only
      // the open word streams into the panel — the other in-flight words
      // just persist quietly.
      const isOpen = selectedRef.current?.word.id === w.id;
      if (isOpen) {
        setEnriching(true);
        setSelected((prev) => prev ? { ...prev, enriched: null, legacy: false } : prev);
      }
      try {
        const [raw, basicInfo] = await Promise.all([
          (async () => {
            let acc = "";
            for await (const chunk of provider.enrich(w.word, controller.signal)) {
              if (controller.signal.aborted) break;
              acc += chunk;
              if (isOpen) {
                const parsed = parseEnrichmentStream(acc);
                setSelected((prev) => prev && prev.word.id === w.id ? { ...prev, enriched: parsed } : prev);
              }
            }
            return acc;
          })(),
          fetchBasicInfo(provider, w.word, targetLevel, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const final = parseEnrichmentStream(raw);
        const zhShort = basicInfo.zh || final.zhShort;
        const level = basicInfo.level || final.level;
        await db.addWordEnriched(w.word, zhShort || w.word, basicInfo.wordType || null, {
          text: final.text,
          zhShort,
          level,
        });
        setWords((prev) => prev.map((x) => x.id === w.id
          ? { ...x, zh: zhShort || x.zh, level: level || x.level, word_type: basicInfo.wordType || x.word_type }
          : x));
        if (isOpen) {
          setSelected((prev) => prev && prev.word.id === w.id
            ? { ...prev, enriched: final, word: { ...prev.word, zh: zhShort || prev.word.zh, level: level || prev.word.level, word_type: basicInfo.wordType || prev.word.word_type } }
            : prev);
        }
        succeeded++;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        failed++;
      } finally {
        done++;
        useVocabEnrichStore.getState().setBulkProgress(done);
        if (isOpen) setEnriching(false);
      }
    };

    // Small worker pool: a few words in flight at once cuts wall time without
    // hammering the provider's rate limits. Workers pull the next word off a
    // shared cursor; aborting stops every worker at its next word boundary
    // (in-flight streams are cancelled through the shared signal).
    const workers = Array.from({ length: Math.min(BULK_CONCURRENCY, targets.length) }, async () => {
      while (!controller.signal.aborted) {
        const i = nextIndex++;
        if (i >= targets.length) break;
        await processWord(targets[i]);
      }
    });
    await Promise.all(workers);

    const aborted = controller.signal.aborted;
    useVocabEnrichStore.getState().finishBulk();
    loadWords();
    loadAllWordsSet();
    if (succeeded > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    if (!aborted) {
      toast.success(
        t("vocab.bulkEnrichDone", { done: succeeded }) +
          (failed > 0 ? t("vocab.bulkEnrichFailedSuffix", { failed }) : "")
      );
    }
  };

  const enrichUnanalyzed = async () => {
    if (bulkRunning) return;
    const all = await db.getWords();
    runBulkEnrich(all.filter((w) => !w.enriched));
  };

  const reanalyzeAll = async () => {
    setReanalyzeConfirmOpen(false);
    if (bulkRunning) return;
    const all = await db.getWords();
    runBulkEnrich(all);
  };

  const stopBulkEnrich = () => useVocabEnrichStore.getState().bulk.controller?.abort();

  const reanalyzeSelected = async () => {
    if (bulkRunning) return;
    const targets = words.filter((w) => selectedIds.has(w.id));
    exitWordSelectMode();
    await runBulkEnrich(targets);
  };

  const deleteSelected = async () => {
    if (deletingSelected) return;
    setDeletingSelected(true);
    const ok = await db.deleteWordsBatch([...selectedIds]);
    if (ok) {
      toast.success(t("vocab.wordsDeleted", { n: selectedIds.size }));
      if (selected && selectedIds.has(selected.word.id)) setSelected(null);
      exitWordSelectMode();
      await loadWords();
      await loadAllWordsSet();
    }
    setDeletingSelected(false);
    setDeleteSelectedOpen(false);
  };

  const loadWords = async () => {
    const results = await db.getWords({
      search: debouncedSearch || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
    setWords(results);
    setPage(0);
  };

  useEffect(() => { loadWords(); }, [debouncedSearch, dateFrom, dateTo]);

  const refreshList = async () => {
    await Promise.all([loadWords(), loadAllWordsSet()]);
    toast.success(t("vocab.refreshed"));
  };

  // Full, unfiltered vocabulary set — its size drives the "re-analyze all" confirm count.
  const [allWordsSet, setAllWordsSet] = useState<Set<string>>(new Set());
  const loadAllWordsSet = async () => {
    const all = await db.getWords();
    setAllWordsSet(new Set(all.map((w) => w.word.toLowerCase())));
  };
  useEffect(() => { loadAllWordsSet(); }, []);

  useEffect(() => {
    const handler = () => { loadWords(); loadAllWordsSet(); };
    window.addEventListener("vocab-updated", handler);
    return () => window.removeEventListener("vocab-updated", handler);
  }, [debouncedSearch, dateFrom, dateTo]);

  const visibleWords = useMemo(
    () => words.filter((w) => matchesLevels(w.level, levelFilters)),
    [words, levelFilters]
  );

  // Dictionary behavior: the searched term isn't in the vocabulary → offer AI lookup
  const showAiLookup = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || !/^[a-z][a-z\s'-]*$/i.test(q)) return false;
    return !words.some((w) => w.word.toLowerCase() === q);
  }, [debouncedSearch, words]);

  // ── Select word (from the vocabulary list) ───────────────────────────────

  const selectWord = async (w: WordListItem) => {
    // Only the throwaway lookup stream is cancelled here. A saved word's enrichment keeps
    // running in the background (vocabEnrichStore tracks it, CommandBar shows it) so that
    // switching words mid-analysis doesn't discard work — coming back re-attaches to it.
    lookupControllerRef.current?.abort();
    setEnriching(false);
    setEnrichError("");
    setLookup(null);
    setNotes("");
    try {
      const [detail, extras] = await Promise.all([
        db.getWordDetail(w.id),
        db.getWordExtras(w.id),
      ]);

      let enriched: ParsedEnrichment | null = null;
      let legacy = false;
      if (detail?.enrichment_text) {
        enriched = { text: detail.enrichment_text, level: detail.level ?? undefined, zhShort: detail.definitions?.[0]?.zh };
      } else if (detail?.enrichment_json) {
        legacy = true;
      }

      const wordNotes = extras?.notes || "";
      setNotes(wordNotes);
      setSelected({ word: w, enriched, legacy, notes: wordNotes });
    } catch {
      setSelected({ word: w, enriched: null, legacy: false, notes: "" });
    }
  };

  // ── Enrich a saved word (explicit trigger from the detail panel) ─────────

  const enrichSelected = async (word: string) => {
    const provider = findBestProvider();
    if (!provider) {
      setEnrichError(t("vocab.noApiKey"));
      return;
    }
    const controller = useVocabEnrichStore.getState().startSingle(word);

    setEnriching(true);
    setEnrichError("");
    setSelected((prev) => prev ? { ...prev, enriched: null, legacy: false } : prev);

    let raw = "";
    try {
      // Update the list item (and the detail header) as soon as this resolves —
      // don't make it wait for the much slower full-explanation stream to finish.
      const basicInfoPromise = fetchBasicInfo(provider, word, targetLevel, controller.signal).then((info) => {
        if (controller.signal.aborted) return info;
        if (info.zh || info.level || info.wordType) {
          setWords((prev) => prev.map((w) => w.word === word
            ? { ...w, zh: info.zh || w.zh, level: info.level || w.level, word_type: info.wordType || w.word_type }
            : w));
          setSelected((prev) => prev && prev.word.word === word
            ? { ...prev, word: { ...prev.word, zh: info.zh || prev.word.zh, level: info.level || prev.word.level, word_type: info.wordType || prev.word.word_type } }
            : prev);
        }
        return info;
      });
      // The enrich stream is prompted to open with a `META: <level> | <short gloss>` line
      // (see parseEnrichmentStream) before the much longer explanation body — so the short
      // gloss is usually available within the first chunk or two. Apply it to the list/detail
      // state as soon as it shows up, once, rather than waiting for the whole stream (which
      // can take a while) to finish.
      let appliedStreamMeta = false;
      for await (const chunk of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        raw += chunk;
        const parsed = parseEnrichmentStream(raw);
        useVocabEnrichStore.getState().setSingleText(word, raw);
        setSelected((prev) => prev?.word.word === word ? { ...prev, enriched: parsed } : prev);
        if (!appliedStreamMeta && (parsed.zhShort || parsed.level)) {
          appliedStreamMeta = true;
          const backfillZh = (current: string | null) => (current?.trim() ? current : parsed.zhShort || word);
          setWords((prev) => prev.map((w) => w.word === word
            ? { ...w, zh: backfillZh(w.zh), level: parsed.level || w.level }
            : w));
          setSelected((prev) => prev && prev.word.word === word
            ? { ...prev, word: { ...prev.word, zh: backfillZh(prev.word.zh), level: parsed.level || prev.word.level } }
            : prev);
        }
      }
      if (controller.signal.aborted) {
        useVocabEnrichStore.getState().clearSingle(word, controller);
        return;
      }

      const final = parseEnrichmentStream(raw);
      const basicInfo = await basicInfoPromise;
      const zhShort = basicInfo.zh || final.zhShort;
      const wordType = basicInfo.wordType || null;
      const level = basicInfo.level || final.level;
      await db.addWordEnriched(word, zhShort || word, wordType, {
        text: final.text,
        zhShort,
        level,
      }).catch(() => {});

      // The earlier optimistic update (right after basicInfoPromise resolves) only applied
      // info.zh — if that came back empty but the full enrichment stream's zhShort didn't,
      // the list would stay stuck showing no gloss even though the DB write above (which
      // uses that same zhShort fallback) succeeded. Sync the list/detail state to exactly
      // what got persisted so the two can never drift apart — including the "no gloss
      // already, and the AI didn't produce one either" case, where the backend backfills
      // the word itself rather than leaving the definition permanently blank.
      const backfillZh = (current: string | null) => (current?.trim() ? current : zhShort || word);
      if (zhShort || level || wordType) {
        setWords((prev) => prev.map((w) => w.word === word
          ? { ...w, zh: backfillZh(w.zh), level: level || w.level, word_type: wordType || w.word_type }
          : w));
      }
      // Also re-apply the finished text: the user may have re-selected this word after the
      // last chunk landed, in which case `selected` was rebuilt from a DB row that didn't
      // have the enrichment yet, and nothing else would fill it in.
      setSelected((prev) => prev && prev.word.word === word
        ? {
            ...prev,
            enriched: final,
            legacy: false,
            word: { ...prev.word, zh: backfillZh(prev.word.zh), level: level || prev.word.level, word_type: wordType || prev.word.word_type },
          }
        : prev);

      toast.success(`「${word}」AI 分析完成`);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      useVocabEnrichStore.getState().finishSingle(word, "done", controller);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // Cancelled (by the user, or by a newer re-analyze of this word taking over) —
        // drop the job so it can't leave the panel and the header stuck on "Analyzing".
        useVocabEnrichStore.getState().clearSingle(word, controller);
        return;
      }
      const errMsg = e.message?.includes("Load failed") || e.message?.includes("fetch")
        ? t("vocab.networkError")
        : (e.message || t("vocab.aiError"));
      if (selectedRef.current?.word.word === word) setEnrichError(errMsg);
      toast.error(errMsg);
      useVocabEnrichStore.getState().finishSingle(word, "error", controller);
    } finally {
      if (!controller.signal.aborted) setEnriching(false);
    }
  };

  // ── AI dictionary lookup (word not in the vocabulary) ───────────────────

  const startLookup = async (query: string) => {
    const word = query.trim();
    if (!word || enriching) return;

    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }

    lookupControllerRef.current?.abort();
    const controller = new AbortController();
    lookupControllerRef.current = controller;

    setSelected(null);
    setLookup({ word, enriched: null, basicInfo: {}, added: false, wordId: null });
    setEnriching(true);
    setEnrichError("");

    let raw = "";
    try {
      fetchBasicInfo(provider, word, targetLevel, controller.signal).then((basicInfo) => {
        setLookup((prev) => prev?.word === word ? { ...prev, basicInfo } : prev);
      });
      for await (const chunk of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        raw += chunk;
        const parsed = parseEnrichmentStream(raw);
        setLookup((prev) => prev?.word === word ? { ...prev, enriched: parsed } : prev);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      const errMsg = e.message?.includes("Load failed") || e.message?.includes("fetch")
        ? t("vocab.networkError")
        : (e.message || t("vocab.aiError"));
      setEnrichError(errMsg);
      toast.error(errMsg);
    } finally {
      if (!controller.signal.aborted) setEnriching(false);
    }
  };

  const addLookupToVocab = async () => {
    if (!lookup?.enriched || lookup.added) return;
    try {
      const zhShort = lookup.basicInfo.zh || lookup.enriched.zhShort;
      const result = await db.addWordEnriched(lookup.word, zhShort || lookup.word, lookup.basicInfo.wordType || null, {
        text: lookup.enriched.text,
        zhShort,
        level: lookup.basicInfo.level || lookup.enriched.level,
      });
      setLookup((prev) => prev ? { ...prev, added: true, wordId: result.id } : prev);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(`「${lookup.word}」已加入词库`);
    } catch {
      toast.error(t("vocab.aiError"));
    }
  };

  // ── Notes (autosaved by LazyWordNotesEditor) ────────────────────────────

  const saveNotes = async (text: string) => {
    if (!selected) return;
    setNotes(text);
    try {
      await db.saveWordNotes(selected.word.id, text);
      window.dispatchEvent(new CustomEvent("word-notes-updated", { detail: { wordId: selected.word.id, notes: text } }));
    } catch {
      toast.error("保存失败，请重试");
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { wordId, notes: updatedNotes } = (e as CustomEvent).detail;
      if (selected?.word.id === wordId) setNotes(updatedNotes);
    };
    window.addEventListener("word-notes-updated", handler);
    return () => window.removeEventListener("word-notes-updated", handler);
  }, [selected?.word.id]);

  // ── Initial selection ───────────────────────────────────────────────────

  useEffect(() => {
    if (lookup) return;
    if (initialWordId && words.length > 0) {
      const w = words.find((x) => x.id === initialWordId);
      if (w) selectWord(w);
    } else if (words.length > 0 && !selected) {
      selectWord(words[0]);
    }
  }, [words.length, initialWordId]);

  // ── Render ──────────────────────────────────────────────────────────────

  const activeEnriched = lookup ? lookup.enriched : selected?.enriched ?? streamingEnriched;
  const chatWord = lookup ? lookup.word : selected?.word.word ?? "";
  const chatWordId = lookup ? lookup.wordId : selected?.word.id ?? null;

  // Publish the selected word so ToolsModal's word-chat tab can show it.
  const setSelectedWord = useSelectedWordStore((s) => s.setSelectedWord);
  const clearSelectedWord = useSelectedWordStore((s) => s.clear);
  useEffect(() => {
    setSelectedWord({ wordId: chatWordId, word: chatWord, enrichedContext: activeEnriched?.text || "" });
  }, [chatWordId, chatWord, activeEnriched, setSelectedWord]);
  useEffect(() => () => clearSelectedWord(), [clearSelectedWord]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 bg-background">
        <div className="flex items-center gap-1">
          {(["words", "patterns"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setView(tab)}
              className={`h-7 rounded-lg px-3 text-xs font-semibold transition-colors ${view === tab ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {t(tab === "words" ? "vocab.tabWords" : "vocab.tabPatterns")}
            </button>
          ))}
        </div>
      </div>
      {view === "patterns" ? <PatternLibrary initialQuery={patternSeed} onSeedConsumed={() => setPatternSeed(null)} /> : (
      <div className="flex min-h-0 flex-1">
      <WordListPanel
        words={visibleWords}
        selectedId={selected?.word.id ?? null}
        search={search}
        levelFilter={levelFilters}
        page={page}
        pageSize={PAGE_SIZE}
        showAiLookup={showAiLookup}
        lookupActive={!!lookup}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        onFilterChange={(v) => { setLevelFilters(v); setPage(0); }}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onRefresh={refreshList}
        onSelect={selectWord}
        onPageChange={setPage}
        onDoubleClick={handleWordDoubleClick}
        onAiLookup={startLookup}
        bulkRunning={bulkRunning}
        bulkProgress={bulkProgress}
        onEnrichUnanalyzed={enrichUnanalyzed}
        onReanalyzeAll={() => setReanalyzeConfirmOpen(true)}
        onStopBulkEnrich={stopBulkEnrich}
        collapsed={listCollapsed}
        onToggleCollapsed={toggleListCollapsed}
        selectedIds={selectedIds}
        onToggleSelect={toggleWordSelect}
        onSelectAll={selectAllWords}
        onClearSelection={clearWordSelection}
        onReanalyzeSelected={reanalyzeSelected}
        onDeleteSelected={() => setDeleteSelectedOpen(true)}
        onToggleStar={toggleWordStar}
        selectMode={selectMode}
        onToggleSelectMode={toggleWordSelectMode}
      />

      <WordDetailPanel
        selected={{
          word: lookup ? lookup.word : selected?.word.word ?? "",
          zh: lookup ? lookup.basicInfo.zh ?? lookup.enriched?.zhShort ?? null : selected?.word.zh ?? null,
          wordType: lookup ? lookup.basicInfo.wordType ?? null : selected?.word.word_type ?? null,
          level: lookup ? lookup.basicInfo.level ?? lookup.enriched?.level ?? null : selected?.word.level ?? null,
          ipa: "",
        }}
        wordId={lookup ? null : selected?.word.id ?? null}
        enriched={activeEnriched}
        enriching={lookup ? enriching : effectiveEnriching}
        enrichError={enrichError}
        legacy={lookup || selectedWordJobRunning ? false : selected?.legacy ?? false}
        notes={notes}
        lookupMode={!!lookup}
        lookupAdded={lookup?.added ?? false}
        onAddToVocab={addLookupToVocab}
        onNotesChange={saveNotes}
        onClearNotes={() => saveNotes("")}
        onRetry={() => {
          if (lookup) startLookup(lookup.word);
          else if (selected) enrichSelected(selected.word.word);
        }}
        onReenrich={() => selected && enrichSelected(selected.word.word)}
        onGeneratePatterns={chatWord ? () => { setPatternSeed(chatWord); setView("patterns"); } : undefined}
      />
      </div>
      )}

      <ConfirmModal
        open={reanalyzeConfirmOpen}
        title={t("vocab.reanalyzeConfirmTitle")}
        message={t("vocab.reanalyzeConfirmMessage", { n: allWordsSet.size })}
        confirmLabel={t("vocab.reanalyzeConfirmConfirm")}
        danger
        onConfirm={reanalyzeAll}
        onCancel={() => setReanalyzeConfirmOpen(false)}
      />

      <ConfirmModal
        open={deleteSelectedOpen}
        title={t("vocab.deleteSelectedConfirmTitle", { n: selectedIds.size })}
        message={t("vocab.deleteSelectedConfirmMessage")}
        confirmLabel={deletingSelected ? t("vocab.deleting") : t("vocab.deleteSelectedConfirmConfirm")}
        confirmDisabled={deletingSelected}
        danger
        onConfirm={deleteSelected}
        onCancel={() => !deletingSelected && setDeleteSelectedOpen(false)}
      />
    </div>
  );
}
