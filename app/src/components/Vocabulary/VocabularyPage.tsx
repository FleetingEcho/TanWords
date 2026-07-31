import React, { useState, useEffect } from "react";
import { useDB } from "@/hooks/useDB";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { WordListPanel } from "./WordListPanel";
import { WordDetailPanel } from "./WordDetailPanel";
import { PatternLibrary } from "./PatternLibrary";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useVocabWordList } from "./hooks/useVocabWordList";
import { useVocabWordDetail } from "./hooks/useVocabWordDetail";
import { useVocabBulkEnrich } from "./hooks/useVocabBulkEnrich";
import { useVocabEnrichSelected } from "./hooks/useVocabEnrichSelected";
import { useVocabLookup } from "./hooks/useVocabLookup";
import { SentenceModal } from "./SentenceModal";

export function VocabularyPage({ initialWordId, initialSentenceId }: { initialWordId?: number; initialSentenceId?: number }) {
  const db = useDB();
  const t = useT();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  const list = useVocabWordList(db);
  const detail = useVocabWordDetail(db);
  const { enrichSelected } = useVocabEnrichSelected({
    db, targetLevel,
    selectedRef: detail.selectedRef, setSelected: detail.setSelected, setWords: list.setWords,
    setEnriching: detail.setEnriching, setEnrichError: detail.setEnrichError,
  });
  const { startLookup, addLookupToVocab } = useVocabLookup({
    db, targetLevel, enriching: detail.enriching, lookup: detail.lookup,
    setLookup: detail.setLookup, setSelected: detail.setSelected, setEnriching: detail.setEnriching,
    setEnrichError: detail.setEnrichError, lookupControllerRef: detail.lookupControllerRef,
  });
  const bulkEnrich = useVocabBulkEnrich({
    db, targetLevel, setWords: list.setWords,
    selectedRef: detail.selectedRef, setSelected: detail.setSelected, setEnriching: detail.setEnriching,
    loadWords: list.loadWords, loadAllWordsSet: list.loadAllWordsSet,
  });

  const [view, setView] = useState<"words" | "patterns">("words");
  // The generate-sentences modal lives here rather than inside PatternLibrary
  // so asking a word on the Words tab for examples doesn't have to switch tabs
  // to reach it — the modal opens over whichever tab you were already on.
  const [genWord, setGenWord] = useState<string | null>(null);
  const [existingSentences, setExistingSentences] = useState<string[]>([]);

  // Only needed to dedupe generated candidates, so it is loaded when the modal
  // opens rather than kept in sync with the library all the time.
  useEffect(() => {
    if (genWord === null) return;
    let cancelled = false;
    void db.listPatterns().then((patterns) => {
      if (!cancelled) setExistingSentences(patterns.flatMap((p) => p.examples.map((e) => e.sentence)));
    });
    return () => { cancelled = true; };
  }, [genWord, db]);
  useEffect(() => {
    if (initialSentenceId) setView("patterns");
    else if (initialWordId) setView("words");
  }, [initialWordId, initialSentenceId]);

  // Words layout: the classic list + detail split, or a single full-width
  // list (like the Sentences tab) where the detail expands inline below the
  // selected word.
  const [wordsLayout, setWordsLayout] = useState<"split" | "full">(
    () => (localStorage.getItem("vocab-words-layout") === "full" ? "full" : "split")
  );
  const toggleWordsLayout = () => setWordsLayout((current) => {
    const next = current === "full" ? "split" : "full";
    localStorage.setItem("vocab-words-layout", next);
    return next;
  });
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem("vocab-wordlist-collapsed") === "1");
  const toggleListCollapsed = () => setListCollapsed((current) => {
    localStorage.setItem("vocab-wordlist-collapsed", current ? "0" : "1");
    return !current;
  });

  const reanalyzeSelected = async () => {
    if (bulkEnrich.bulkRunning) return;
    const targets = list.words.filter((w) => list.selectedIds.has(w.id));
    list.exitWordSelectMode();
    await bulkEnrich.runBulkEnrich(targets);
  };

  // ── Initial selection ───────────────────────────────────────────────────

  useEffect(() => {
    if (detail.lookup) return;
    if (initialWordId && list.words.length > 0) {
      const w = list.words.find((x) => x.id === initialWordId);
      if (w) {
        list.setLevelFilters([]);
        list.setStarredOnly(false);
        setListCollapsed(false);
        list.setPage(Math.floor(list.words.findIndex((x) => x.id === initialWordId) / list.pageSize));
        detail.selectWord(w);
      }
    } else if (wordsLayout === "split" && list.words.length > 0 && !detail.selected) {
      // Only the split layout auto-selects — in the full-width list an
      // auto-expanded first row would just be noise.
      detail.selectWord(list.words[0]);
    }
  }, [list.words.length, initialWordId, list.pageSize]);

  // ── Render ──────────────────────────────────────────────────────────────

  const { selected, lookup, notes, enriching, enrichError, effectiveEnriching, selectedWordJobRunning, streamingEnriched } = detail;
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

  const wordDetail = (
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
        onNotesChange={detail.saveNotes}
        onClearNotes={() => detail.saveNotes("")}
        onRetry={() => {
          if (lookup) startLookup(lookup.word);
          else if (selected) enrichSelected(selected.word.word);
        }}
        onReenrich={() => selected && enrichSelected(selected.word.word)}
        onGeneratePatterns={chatWord ? () => setGenWord(chatWord) : undefined}
      />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 bg-transparent">
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
      {view === "patterns" ? <PatternLibrary initialSentenceId={initialSentenceId} /> : (
      <div className="flex min-h-0 flex-1">
      <WordListPanel
        words={list.visibleWords}
        selectedId={selected?.word.id ?? null}
        highlightId={initialWordId}
        search={list.search}
        levelFilter={list.levelFilters}
        page={list.page}
        pageSize={list.pageSize}
        showAiLookup={list.showAiLookup}
        lookupActive={!!lookup}
        dateFrom={list.dateFrom}
        dateTo={list.dateTo}
        onSearchChange={(v) => { list.setSearch(v); list.setPage(0); }}
        onFilterChange={(v) => { list.setLevelFilters(v); list.setPage(0); }}
        starredOnly={list.starredOnly}
        onStarredOnlyChange={(v) => { list.setStarredOnly(v); list.setPage(0); }}
        onDateFromChange={list.setDateFrom}
        onDateToChange={list.setDateTo}
        onRefresh={list.refreshList}
        onSelect={(w) => {
          // In the full-width list, clicking the expanded word collapses it.
          if (wordsLayout === "full" && !lookup && selected?.word.id === w.id) detail.setSelected(null);
          else detail.selectWord(w);
        }}
        onPageChange={list.setPage}
        onPageSizeChange={list.changePageSize}
        onDoubleClick={list.handleWordDoubleClick}
        onAiLookup={startLookup}
        bulkRunning={bulkEnrich.bulkRunning}
        bulkProgress={bulkEnrich.bulkProgress}
        onEnrichUnanalyzed={bulkEnrich.enrichUnanalyzed}
        onReanalyzeAll={() => bulkEnrich.setReanalyzeConfirmOpen(true)}
        onStopBulkEnrich={bulkEnrich.stopBulkEnrich}
        collapsed={listCollapsed}
        onToggleCollapsed={toggleListCollapsed}
        selectedIds={list.selectedIds}
        onToggleSelect={list.toggleWordSelect}
        onSelectAll={list.selectAllWords}
        onClearSelection={list.clearWordSelection}
        onReanalyzeSelected={reanalyzeSelected}
        onDeleteSelected={() => list.setDeleteSelectedOpen(true)}
        onToggleStar={list.toggleWordStar}
        selectMode={list.selectMode}
        onToggleSelectMode={list.toggleWordSelectMode}
        fullWidth={wordsLayout === "full"}
        onToggleLayout={toggleWordsLayout}
        renderDetail={() => wordDetail}
      />

      {wordsLayout === "split" && wordDetail}
      </div>
      )}

      <ConfirmModal
        open={bulkEnrich.reanalyzeConfirmOpen}
        title={t("vocab.reanalyzeConfirmTitle")}
        message={t("vocab.reanalyzeConfirmMessage", { n: list.allWordsSet.size })}
        confirmLabel={t("vocab.reanalyzeConfirmConfirm")}
        danger
        onConfirm={bulkEnrich.reanalyzeAll}
        onCancel={() => bulkEnrich.setReanalyzeConfirmOpen(false)}
      />

      <ConfirmModal
        open={list.deleteSelectedOpen}
        title={t("vocab.deleteSelectedConfirmTitle", { n: list.selectedIds.size })}
        message={t("vocab.deleteSelectedConfirmMessage")}
        confirmLabel={list.deletingSelected ? t("vocab.deleting") : t("vocab.deleteSelectedConfirmConfirm")}
        confirmDisabled={list.deletingSelected}
        danger
        onConfirm={() => list.deleteSelected((ids) => {
          if (selected && ids.has(selected.word.id)) detail.setSelected(null);
        })}
        onCancel={() => !list.deletingSelected && list.setDeleteSelectedOpen(false)}
      />

      {/* Rendered at page level, not inside PatternLibrary: asking a word for
        * example sentences should open this over the Words tab you are on, not
        * throw you across to the Sentences tab to reach the same dialog. */}
      <SentenceModal
        open={genWord !== null}
        onClose={() => setGenWord(null)}
        initialMode="generate"
        initialQuery={genWord}
        existingSentences={existingSentences}
        onAdded={() => window.dispatchEvent(new CustomEvent("patterns-updated"))}
      />
    </div>
  );
}
