import React, { useState, useEffect, useRef } from "react";
import { useDB } from "@/hooks/useDB";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { WordListPanel } from "./WordListPanel";
import { WordDetailPanel } from "./WordDetailPanel";
import { SentenceLibrary } from "./SentenceLibrary";
import { VocabViewTabs, type VocabView } from "./VocabViewTabs";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useVocabWordList } from "./hooks/useVocabWordList";
import { useVocabWordDetail } from "./hooks/useVocabWordDetail";
import { useVocabBulkEnrich } from "./hooks/useVocabBulkEnrich";
import { useVocabEnrichSelected } from "./hooks/useVocabEnrichSelected";
import { useVocabLookup } from "./hooks/useVocabLookup";
import { SentenceModal } from "./SentenceModal";
import { useIsNarrow } from "./hooks/useMediaQuery";
import { ChevronLeft } from "lucide-react";

export function VocabularyPage({ initialWordId, initialSentenceId }: { initialWordId?: number; initialSentenceId?: number }) {
  const db = useDB();
  const t = useT();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const hasCustomAppBackground = useSettingsStore((state) => !!state.appBackgroundImage && state.appBackgroundVisible);

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

  // Was `| "review"` as well, but nothing ever set it and nothing rendered it
  // — ReviewPanel is not imported anywhere. A third state the switcher would
  // have had to account for, that could not occur.
  const [view, setView] = useState<VocabView>("words");
  // Below lg the list+detail split collapses into list-with-overlay; the same
  // flag gates the desktop-only auto-select below.
  const narrow = useIsNarrow();
  // The generate-sentences modal lives here rather than inside SentenceLibrary
  // so asking a word on the Words tab for examples doesn't have to switch tabs
  // to reach it — the modal opens over whichever tab you were already on.
  const [genWord, setGenWord] = useState<string | null>(null);
  const [existingSentences, setExistingSentences] = useState<string[]>([]);

  // Only needed to dedupe generated candidates, so it is loaded when the modal
  // opens rather than kept in sync with the library all the time.
  useEffect(() => {
    if (genWord === null) return;
    let cancelled = false;
    void db.listSentences().then((sentences) => {
      if (!cancelled) setExistingSentences(sentences.map((s) => s.sentence));
    });
    return () => { cancelled = true; };
  }, [genWord, db]);
  useEffect(() => {
    if (initialSentenceId !== undefined) setView("sentences");
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

  // One-shot for the deep-linked word: without the guard this effect re-ran
  // on every list-length change (a `vocab-updated` event reloading words
  // mid-browsing yanked the user back to the deep-linked word and reset
  // their filters). The auto-select branch re-running is harmless (guarded
  // by !detail.selected).
  const didInitialJumpRef = useRef(false);
  useEffect(() => {
    if (detail.lookup) return;
    if (initialWordId && !didInitialJumpRef.current && list.words.length > 0) {
      const w = list.words.find((x) => x.id === initialWordId);
      if (w) {
        didInitialJumpRef.current = true;
        list.setLevelFilters([]);
        list.setStarredOnly(false);
        setListCollapsed(false);
        list.setPage(Math.floor(list.words.findIndex((x) => x.id === initialWordId) / list.pageSize));
        detail.selectWord(w);
      }
    } else if (!narrow && wordsLayout === "split" && list.words.length > 0 && !detail.selected) {
      // Desktop split layout auto-selects the first word. On mobile the
      // selection opens the full-screen detail overlay instead, which would
      // cover the list before the user has even seen it — don't.
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

  const viewTabs = <VocabViewTabs view={view} onSelect={setView} />;

  return (
    <div className="flex h-full flex-col">
      {/* No bar of its own: the switcher is handed to whichever list is
        * showing and rendered as that list's heading — see VocabViewTabs. A
        * full-width bordered strip for two words, sitting directly above a
        * heading that repeated the selected one, was a row of chrome the page
        * paid for twice. */}
      {view === "sentences" ? (
        <SentenceLibrary initialSentenceId={initialSentenceId} viewTabs={viewTabs} />
      ) : (<>
      <div className="flex min-h-0 flex-1">
      <WordListPanel
        viewTabs={viewTabs}
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
        fullWidth={wordsLayout === "full" || narrow}
        inlineDetail={!narrow}
        onToggleLayout={toggleWordsLayout}
        renderDetail={() => wordDetail}
      />

      {/* Desktop split pane keeps the detail beside the list; on mobile the
        * same selection opens the overlay below instead. */}
      {!narrow && wordsLayout === "split" && wordDetail}
      </div>

      {/* Mobile (<lg): selection pushes a full-screen detail overlay with a
        * back affordance, hiding the bottom tab bar beneath it for space. */}
      {narrow && (selected || lookup) && (
        <div className={`fixed inset-0 z-50 flex flex-col overflow-hidden lg:hidden ${
          hasCustomAppBackground ? "bg-background/70 backdrop-blur-xl" : "bg-background"
        }`}>
          <div className="flex h-12 shrink-0 items-center border-b border-border px-2">
            <button
              type="button"
              onClick={() => (lookup ? detail.setLookup(null) : detail.setSelected(null))}
              className="flex h-10 items-center gap-1 rounded-lg px-2 pr-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("vocab.detailBack")}
            </button>
          </div>
          <div className="flex min-h-0 flex-1">{wordDetail}</div>
        </div>
      )}
      </>)}

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

      {/* Rendered at page level, not inside SentenceLibrary: asking a word for
        * example sentences should open this over the Words tab you are on, not
        * throw you across to the Sentences tab to reach the same dialog. */}
      <SentenceModal
        open={genWord !== null}
        onClose={() => setGenWord(null)}
        initialMode="generate"
        initialQuery={genWord}
        existingSentences={existingSentences}
        onAdded={() => window.dispatchEvent(new CustomEvent("sentences-updated"))}
      />
    </div>
  );
}
