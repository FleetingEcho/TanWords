import React, { useState, useEffect, useMemo, useRef } from "react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useWordModalStore } from "@/store/wordModalStore";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { WordListPanel, LevelFilter, DateField } from "./WordListPanel";
import { WordDetailPanel } from "./WordDetailPanel";
import { GenerateVocabModal } from "./GenerateVocabModal";
import { PatternLibrary } from "./PatternLibrary";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

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
  added: boolean;
  wordId: number | null;
}

const PAGE_SIZE = 50;

export function VocabularyPage({ initialWordId }: { initialWordId?: number }) {
  const db = useDB();
  const openWordModal = useWordModalStore((s) => s.openWordModal);

  // Data
  const [words, setWords] = useState<WordListItem[]>([]);
  const [selected, setSelected] = useState<SelectedWordData | null>(null);
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [notes, setNotes] = useState("");

  // Filters
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateField, setDateField] = useState<DateField>("created");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [view, setView] = useState<"words" | "patterns">("words");
  const [patternSeed, setPatternSeed] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem("vocab-wordlist-collapsed") === "1");
  const toggleListCollapsed = () => setListCollapsed((current) => {
    localStorage.setItem("vocab-wordlist-collapsed", current ? "0" : "1");
    return !current;
  });

  // ── Multi-select (header actions: reanalyze / delete selected) ─────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleWordSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearWordSelection = () => setSelectedIds(new Set());
  const selectAllWords = () => setSelectedIds(new Set(visibleWords.map((w) => w.id)));
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
  const enrichControllerRef = useRef<AbortController | null>(null);
  const t = useT();

  useEffect(() => {
    return () => enrichControllerRef.current?.abort();
  }, []);

  // ── Bulk enrichment (header buttons: enrich un-analyzed / re-analyze all) ──

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false);
  const bulkAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => bulkAbortRef.current?.abort();
  }, []);

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

    const controller = new AbortController();
    bulkAbortRef.current = controller;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: targets.length });

    let succeeded = 0;
    let failed = 0;
    for (const w of targets) {
      if (controller.signal.aborted) break;
      try {
        let raw = "";
        for await (const chunk of provider.enrich(w.word, controller.signal)) {
          if (controller.signal.aborted) break;
          raw += chunk;
        }
        if (controller.signal.aborted) break;
        const final = parseEnrichmentStream(raw);
        await db.addWordEnriched(w.word, final.zhShort || w.word, null, {
          text: final.text,
          zhShort: final.zhShort,
          level: final.level,
        });
        succeeded++;
      } catch (e: any) {
        if (e?.name === "AbortError") break;
        failed++;
      } finally {
        setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }
    }

    const aborted = controller.signal.aborted;
    bulkAbortRef.current = null;
    setBulkRunning(false);
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

  const stopBulkEnrich = () => bulkAbortRef.current?.abort();

  const reanalyzeSelected = async () => {
    if (bulkRunning) return;
    const targets = words.filter((w) => selectedIds.has(w.id));
    clearWordSelection();
    await runBulkEnrich(targets);
  };

  const deleteSelected = async () => {
    if (deletingSelected) return;
    setDeletingSelected(true);
    const ok = await db.deleteWordsBatch([...selectedIds]);
    if (ok) {
      toast.success(t("vocab.wordsDeleted", { n: selectedIds.size }));
      if (selected && selectedIds.has(selected.word.id)) setSelected(null);
      clearWordSelection();
      await loadWords();
      await loadAllWordsSet();
    }
    setDeletingSelected(false);
    setDeleteSelectedOpen(false);
  };

  const loadWords = async () => {
    const results = await db.getWords({
      search: debouncedSearch || undefined,
      levelFilter: levelFilter === "all" ? undefined : levelFilter,
      dateField,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
    setWords(results);
    setPage(0);
  };

  useEffect(() => { loadWords(); }, [levelFilter, debouncedSearch, dateField, dateFrom, dateTo]);

  // Full, unfiltered vocabulary set — used for dedup in GenerateVocabModal, which
  // must check against the whole vocabulary regardless of the list's current filters.
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
  }, [levelFilter, debouncedSearch, dateField, dateFrom, dateTo]);

  // Source filtering is client-side: getWords returns the full result set
  const sources = useMemo(
    () => [...new Set(words.map((w) => w.source))].sort(),
    [words]
  );
  const visibleWords = useMemo(
    () => (sourceFilter === "all" ? words : words.filter((w) => w.source === sourceFilter)),
    [words, sourceFilter]
  );

  // Dictionary behavior: the searched term isn't in the vocabulary → offer AI lookup
  const showAiLookup = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || !/^[a-z][a-z\s'-]*$/i.test(q)) return false;
    return !words.some((w) => w.word.toLowerCase() === q);
  }, [debouncedSearch, words]);

  // ── Select word (from the vocabulary list) ───────────────────────────────

  const selectWord = async (w: WordListItem) => {
    enrichControllerRef.current?.abort();
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
    enrichControllerRef.current?.abort();
    const controller = new AbortController();
    enrichControllerRef.current = controller;

    setEnriching(true);
    setEnrichError("");
    setSelected((prev) => prev ? { ...prev, legacy: false } : prev);

    let raw = "";
    try {
      for await (const chunk of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        raw += chunk;
        const parsed = parseEnrichmentStream(raw);
        setSelected((prev) => prev?.word.word === word ? { ...prev, enriched: parsed } : prev);
      }
      if (controller.signal.aborted) return;

      const final = parseEnrichmentStream(raw);
      await db.addWordEnriched(word, final.zhShort || word, null, {
        text: final.text,
        zhShort: final.zhShort,
        level: final.level,
      }).catch(() => {});

      toast.success(`「${word}」AI 分析完成`);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
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

  // ── AI dictionary lookup (word not in the vocabulary) ───────────────────

  const startLookup = async (query: string) => {
    const word = query.trim();
    if (!word || enriching) return;

    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }

    enrichControllerRef.current?.abort();
    const controller = new AbortController();
    enrichControllerRef.current = controller;

    setSelected(null);
    setLookup({ word, enriched: null, added: false, wordId: null });
    setEnriching(true);
    setEnrichError("");

    let raw = "";
    try {
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
      const result = await db.addWordEnriched(lookup.word, lookup.enriched.zhShort || lookup.word, null, {
        text: lookup.enriched.text,
        zhShort: lookup.enriched.zhShort,
        level: lookup.enriched.level,
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

  const activeEnriched = lookup ? lookup.enriched : selected?.enriched ?? null;
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
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        {(["words", "patterns"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`rounded-lg px-3 py-1 text-sm font-medium transition ${view === tab ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {t(tab === "words" ? "vocab.tabWords" : "vocab.tabPatterns")}
          </button>
        ))}
      </div>
      {view === "patterns" ? <PatternLibrary initialQuery={patternSeed} onSeedConsumed={() => setPatternSeed(null)} /> : (
      <div className="flex min-h-0 flex-1">
      <WordListPanel
        words={visibleWords}
        selectedId={selected?.word.id ?? null}
        search={search}
        levelFilter={levelFilter}
        sourceFilter={sourceFilter}
        sources={sources}
        page={page}
        pageSize={PAGE_SIZE}
        showAiLookup={showAiLookup}
        lookupActive={!!lookup}
        dateField={dateField}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        onFilterChange={setLevelFilter}
        onSourceFilterChange={setSourceFilter}
        onDateFieldChange={setDateField}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onSelect={selectWord}
        onPageChange={setPage}
        onDoubleClick={(word) => openWordModal(word)}
        onAiLookup={startLookup}
        onOpenGenerate={() => setGenerateOpen(true)}
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
      />

      <WordDetailPanel
        selected={{
          word: lookup ? lookup.word : selected?.word.word ?? "",
          zh: lookup ? lookup.enriched?.zhShort ?? null : selected?.word.zh ?? null,
          wordType: lookup ? null : selected?.word.word_type ?? null,
          level: lookup ? lookup.enriched?.level ?? null : selected?.word.level ?? null,
          ipa: "",
        }}
        wordId={lookup ? null : selected?.word.id ?? null}
        enriched={activeEnriched}
        enriching={enriching}
        enrichError={enrichError}
        legacy={lookup ? false : selected?.legacy ?? false}
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

      <GenerateVocabModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        existingWords={allWordsSet}
        onAdded={() => { loadWords(); loadAllWordsSet(); }}
      />

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
