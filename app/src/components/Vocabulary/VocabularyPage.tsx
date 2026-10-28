import React, { useState, useEffect, useRef } from "react";
import { useDB } from "@/hooks/useDB";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
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
import { saveDialog, writeBinaryFile, downloadText } from "@/ipc/dialog";
import { isDesktopHost } from "@/platform";

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
    loadWords: list.loadWords, loadAllWordsStats: list.loadAllWordsStats,
  });

  // Words-only export: CSV via save dialog on desktop (the write goes through
  // writeBinaryFile after the user picks a path), browser download on web.
  const [exportingWords, setExportingWords] = useState(false);
  const exportWords = async () => {
    if (exportingWords) return;
    setExportingWords(true);
    try {
      const csv = await db.exportWordsCsv();
      if (csv == null) return;
      const name = `tanwords-words-${new Date().toISOString().slice(0, 10)}.csv`;
      if (isDesktopHost) {
        const dest = await saveDialog({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
        if (!dest) return;
        await writeBinaryFile(dest, new TextEncoder().encode(csv));
      } else {
        downloadText(name, csv, "text/csv");
      }
      toast.success(t("vocab.exportWordsOk"));
    } finally {
      setExportingWords(false);
    }
  };

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

  // One-shot for the deep-linked word. The list is server-paged now, so the
  // jump is two-phase: clear all filters, then watch each arriving page for
  // the target; if the first unfiltered page lacks it, probe its rank once
  // (findWordPage) and move the pager there. The pendingJump guard also keeps
  // the auto-select branch from flashing word #1 while the jump resolves.
  const [pendingJumpId, setPendingJumpId] = useState<number | null>(null);
  const jumpProbedRef = useRef(false);
  useEffect(() => {
    if (initialWordId === undefined) return;
    jumpProbedRef.current = false;
    setPendingJumpId(initialWordId);
    list.clearAllFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per incoming deep-link id
  }, [initialWordId]);

  useEffect(() => {
    if (detail.lookup) return;
    if (pendingJumpId !== null) {
      const w = list.words.find((x) => x.id === pendingJumpId);
      if (w) {
        setListCollapsed(false);
        detail.selectWord(w);
        setPendingJumpId(null);
      } else if (list.loaded && !jumpProbedRef.current) {
        jumpProbedRef.current = true;
        void list.findWordPage(pendingJumpId).then((p) => {
          if (p !== null && p !== list.page) list.setPage(p);
          else setPendingJumpId(null); // word gone, or rank mismatched this sort
        });
      }
    } else if (!narrow && wordsLayout === "split" && list.words.length > 0 && !detail.selected) {
      // Desktop split layout auto-selects the first word. On mobile the
      // selection opens the full-screen detail overlay instead, which would
      // cover the list before the user has even seen it — don't.
      detail.selectWord(list.words[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- guards cover the stale-closure surface
  }, [list.words, list.loaded, pendingJumpId, narrow, wordsLayout]);

  // ── Selection movement (keyboard ↑/↓/j/k in the list, ‹/› in the detail
  // header) — one mover shared by both. The delta is in absolute rows of the
  // filtered list (±1, or ±pageSize for PgUp/PgDn); crossing the current
  // page's edge flips the page and lands on its first/last row, which the
  // effect below performs once the new page's rows arrive.
  const pendingRowRef = useRef<"first" | "last" | null>(null);
  const moveSelection = (delta: number) => {
    const words = list.visibleWords;
    if (list.total === 0 || words.length === 0) return;
    const idx = detail.selected ? words.findIndex((w) => w.id === detail.selected!.word.id) : -1;
    const absBase = idx === -1 ? list.page * list.pageSize + (delta > 0 ? -1 : 0) : list.page * list.pageSize + idx;
    const clamped = Math.min(Math.max(0, absBase + delta), list.total - 1);
    const targetPage = Math.floor(clamped / list.pageSize);
    if (targetPage !== list.page) {
      pendingRowRef.current = clamped - targetPage * list.pageSize === 0 ? "first" : "last";
      list.setPage(targetPage);
    } else {
      const w = words[clamped - list.page * list.pageSize];
      if (w) void detail.selectWord(w);
    }
  };
  useEffect(() => {
    const edge = pendingRowRef.current;
    if (!edge || !list.loaded) return;
    pendingRowRef.current = null;
    const words = list.words;
    if (words.length === 0) return;
    void detail.selectWord(edge === "first" ? words[0] : words[words.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when a page flip lands its rows
  }, [list.loaded]);

  // ‹/› affordance in the detail header: enabled flags track the selected
  // word's absolute index in the filtered list (words page only — the
  // dictionary lookup has no list position).
  const selectedAbsIdx = (() => {
    if (!detail.selected || detail.lookup) return null;
    const i = list.visibleWords.findIndex((w) => w.id === detail.selected!.word.id);
    return i === -1 ? null : list.page * list.pageSize + i;
  })();

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
        tags={lookup ? undefined : selected?.word.tags}
        tagOptions={list.tagOptions}
        scenes={lookup ? undefined : detail.selectedScenes}
        sceneOptions={list.sceneOptions}
        onSetScenes={lookup ? undefined : (next) => {
          if (!selected) return;
          const id = selected.word.id;
          detail.setSelectedScenes(next);
          void db.setWordScenarios(id, next);
        }}
        onPrevWord={lookup ? undefined : () => moveSelection(-1)}
        onNextWord={lookup ? undefined : () => moveSelection(1)}
        hasPrevWord={selectedAbsIdx !== null && selectedAbsIdx > 0}
        hasNextWord={selectedAbsIdx !== null && selectedAbsIdx < list.total - 1}
        onSetTags={lookup ? undefined : (next) => {
          if (!selected) return;
          const id = selected.word.id;
          // Optimistic row update; the tag chip row + category sort read it.
          list.setWords((prev) => prev.map((w) => (w.id === id ? { ...w, tags: next } : w)));
          detail.setSelected((prev) => (prev ? { ...prev, word: { ...prev.word, tags: next } } : prev));
          void db.setWordTags(id, next).then((ok) => {
            if (ok) void list.loadTagOptions();
          });
        }}
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
        total={list.total}
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
        statuses={list.statusFilters}
        onStatusesChange={(v) => { list.setStatusFilters(v); list.setPage(0); }}
        enrichFilter={list.enrichFilter}
        onEnrichFilterChange={(v) => { list.setEnrichFilter(v); list.setPage(0); }}
        dueOnly={list.dueOnly}
        onDueOnlyChange={(v) => { list.setDueOnly(v); list.setPage(0); }}
        sourceFilter={list.sourceFilter}
        onSourceChange={(v) => { list.setSourceFilter(v); list.setPage(0); }}
        tagOptions={list.tagOptions}
        sceneOptions={list.sceneOptions}
        selectedScenes={list.sceneFilters}
        onSceneToggle={list.toggleSceneFilter}
        selectedTags={list.tagFilters}
        onTagToggle={list.toggleTagFilter}
        sortBy={list.sortBy}
        onSortChange={list.changeSortBy}
        sortDesc={list.sortDesc}
        onSortDescToggle={list.toggleSortDesc}
        onClearAllFilters={list.clearAllFilters}
        facets={list.facets}
        onDateFromChange={list.setDateFrom}
        onDateToChange={list.setDateTo}
        onRefresh={list.refreshList}
        onExport={exportWords}
        exportingWords={exportingWords}
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
        onMoveSelection={moveSelection}
        onSelectAll={list.selectAllWords}
        onClearSelection={list.clearWordSelection}
        onReanalyzeSelected={reanalyzeSelected}
        onDeleteSelected={() => list.setDeleteSelectedOpen(true)}
        onToggleStar={list.toggleWordStar}
        onToggleStatus={list.toggleWordStatus}
        onMarkSelectedStatus={list.markSelectedStatus}
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
        <div className={`fixed inset-0 z-[60] flex flex-col overflow-hidden lg:hidden ${
          hasCustomAppBackground ? "bg-background/70 backdrop-blur-xl" : "bg-background"
        }`}>
          <div className="flex h-12 shrink-0 items-center border-b border-border px-2">
            <button
              type="button"
              onClick={() => (lookup ? detail.setLookup(null) : detail.setSelected(null))}
              className="flex h-11 items-center gap-1 rounded-lg px-2 pr-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
        message={t("vocab.reanalyzeConfirmMessage", { n: list.wordStats?.total ?? 0 })}
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
