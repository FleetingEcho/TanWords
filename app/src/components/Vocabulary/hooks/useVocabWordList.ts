import { useState, useEffect, useMemo } from "react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { toast } from "sonner";
import { LevelValue } from "../WordListPanel";
import { matchesLevels } from "@/components/shared/LevelDateFilter";
import { useT } from "@/hooks/useT";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const WORD_PAGE_SIZE_KEY = "vocab-words-page-size";

/** Word list data, filters/pagination, multi-select and star toggling for the
 * Vocabulary page's word list. Kept separate from selection/enrichment state
 * (see useVocabWordDetail) so the two concerns don't tangle in one component. */
export function useVocabWordList(db: ReturnType<typeof useDB>) {
  const t = useT();
  const [words, setWords] = useState<WordListItem[]>([]);

  // Filters — levelFilters is applied client-side (empty = all levels) so
  // toggling level chips never needs a DB round-trip.
  const [levelFilters, setLevelFilters] = useState<LevelValue[]>([]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(WORD_PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(saved as (typeof PAGE_SIZE_OPTIONS)[number]) ? saved : 20;
  });
  const changePageSize = (next: number) => {
    setPageSize(next);
    setPage(0);
    localStorage.setItem(WORD_PAGE_SIZE_KEY, String(next));
  };

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
  const [deletingSelected, setDeletingSelected] = useState(false);

  // ── Star / unstar (optimistic — the toggle should feel instant) ────────
  const toggleWordStar = async (id: number) => {
    const target = words.find((w) => w.id === id);
    if (!target) return;
    const next = !target.starred;
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, starred: next } : w)));
    const ok = await db.setWordStarred(id, next);
    if (!ok) setWords((prev) => prev.map((w) => (w.id === id ? { ...w, starred: !next } : w)));
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadWords = async () => {
    const results = await db.getWords({
      search: debouncedSearch || undefined,
      dateField: "updated",
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
    () => words.filter((w) => matchesLevels(w.level, levelFilters) && (!starredOnly || w.starred)),
    [words, levelFilters, starredOnly]
  );

  // Dictionary behavior: the searched term isn't in the vocabulary → offer AI lookup
  const showAiLookup = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || !/^[a-z][a-z\s'-]*$/i.test(q)) return false;
    return !words.some((w) => w.word.toLowerCase() === q);
  }, [debouncedSearch, words]);

  /** @param onDeleted called with the deleted ids after a successful delete, so
   * callers can clear a currently-open selection that was part of the batch. */
  const deleteSelected = async (onDeleted?: (ids: Set<number>) => void) => {
    if (deletingSelected) return;
    setDeletingSelected(true);
    const ok = await db.deleteWordsBatch([...selectedIds]);
    if (ok) {
      toast.success(t("vocab.wordsDeleted", { n: selectedIds.size }));
      onDeleted?.(selectedIds);
      exitWordSelectMode();
      await loadWords();
      await loadAllWordsSet();
    }
    setDeletingSelected(false);
    setDeleteSelectedOpen(false);
  };

  return {
    words, setWords,
    levelFilters, setLevelFilters,
    starredOnly, setStarredOnly,
    search, setSearch,
    debouncedSearch,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    page, setPage,
    pageSize, changePageSize,
    selectMode, selectedIds,
    toggleWordSelect, clearWordSelection, selectAllWords, toggleWordSelectMode, exitWordSelectMode,
    handleWordDoubleClick,
    deleteSelectedOpen, setDeleteSelectedOpen, deletingSelected, deleteSelected,
    toggleWordStar,
    loadWords, refreshList,
    allWordsSet, loadAllWordsSet,
    visibleWords, showAiLookup,
  };
}

export type VocabWordListState = ReturnType<typeof useVocabWordList>;
