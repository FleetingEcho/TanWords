import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useDB, WordListItem, WordStatus, WordSortBy, EnrichFilter, WordFilterFacets } from "@/hooks/useDB";
import { toast } from "sonner";
import { LevelValue } from "../WordListPanel";
import { loadWordFilters, persistWordFilters } from "../filters/wordFilterDefs";
import { useT } from "@/hooks/useT";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const WORD_PAGE_SIZE_KEY = "vocab-words-page-size";
const WORD_SORT_KEY = "vocab-words-sort";
const WORD_SORT_DESC_KEY = "vocab-words-sort-desc";
const SORT_VALUES: WordSortBy[] = ["recent", "alpha", "freq", "due", "difficulty", "category"];

/** Word list data, filters/pagination, multi-select, star and status toggling
 * for the Vocabulary page's word list. Kept separate from selection/enrichment
 * state (see useVocabWordDetail) so the two concerns don't tangle in one
 * component.
 *
 * Everything filterable lives server-side (db_get_words_page): the list only
 * ever holds ONE page of rows, so a 10k-word library costs one page-sized
 * payload per keystroke/sort/chip change rather than the whole table. */
export function useVocabWordList(db: ReturnType<typeof useDB>) {
  const t = useT();
  const [words, setWords] = useState<WordListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** Filter-bar chip counts, delivered with each page (self-excluded per
   *  axis — the bar never shows a chip zeroing itself out). `null` until the
   *  first faceted response lands — and permanently null against a stale
   *  pre-facets core binary, in which case the bar hides counts entirely
   *  instead of displaying zeros that lie. */
  const [facets, setFacets] = useState<WordFilterFacets | null>(null);

  // ── Filters & sort — every state here feeds the SQL WHERE/ORDER BY
  // directly, so chips/sorts/search all take the same one-page round-trip.
  //
  // The working set (everything except search/dates) persists across sessions
  // — see filters/wordFilterDefs.ts for why and how it's sanitized.
  const [initialFilters] = useState(loadWordFilters);
  const [levelFilters, setLevelFilters] = useState<LevelValue[]>(initialFilters.levels);
  const [statusFilters, setStatusFilters] = useState<WordStatus[]>(initialFilters.statuses);
  const [starredOnly, setStarredOnly] = useState(initialFilters.starred);
  const [enrichFilter, setEnrichFilter] = useState<EnrichFilter>(initialFilters.enrichFilter);
  const [dueOnly, setDueOnly] = useState(initialFilters.dueOnly);
  const [sourceFilter, setSourceFilter] = useState(initialFilters.source);
  // Category tags — multi-select, OR'd in SQL. tagOptions drives the chip row.
  const [tagFilters, setTagFilters] = useState<string[]>(initialFilters.tags);
  const [tagOptions, setTagOptions] = useState<{ tag: string; count: number }[]>([]);

  // Snapshot the working set on every change. Search and the date range stay
  // session-only on purpose (a stale "hidden by search" reopen is the classic
  // "my words vanished" scare).
  useEffect(() => {
    persistWordFilters({
      levels: levelFilters,
      statuses: statusFilters,
      starred: starredOnly,
      enrichFilter,
      dueOnly,
      source: sourceFilter,
      tags: tagFilters,
    });
  }, [levelFilters, statusFilters, starredOnly, enrichFilter, dueOnly, sourceFilter, tagFilters]);
  const [sortBy, setSortBy] = useState<WordSortBy>(() => {
    const saved = localStorage.getItem(WORD_SORT_KEY) as WordSortBy | null;
    return saved && SORT_VALUES.includes(saved) ? saved : "recent";
  });
  const changeSortBy = (next: WordSortBy) => {
    setSortBy(next);
    setPage(0);
    localStorage.setItem(WORD_SORT_KEY, next);
  };
  // Ascending/descending for the sorts that support both (alpha, category,
  // difficulty; freq and recent keep their own shape). Persisted like sortBy.
  const [sortDesc, setSortDesc] = useState(() => localStorage.getItem(WORD_SORT_DESC_KEY) === "1");
  const toggleSortDesc = () => {
    setSortDesc((prev) => {
      localStorage.setItem(WORD_SORT_DESC_KEY, prev ? "0" : "1");
      return !prev;
    });
    setPage(0);
  };
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

  /** Resets every filter axis — used by the deep-link jump so a target word
   *  can't be hidden behind stale chips. Sort is kept: the jump computes the
   *  target's page in the CURRENT order. */
  const clearAllFilters = useCallback(() => {
    setLevelFilters([]);
    setStatusFilters([]);
    setStarredOnly(false);
    setEnrichFilter("all");
    setDueOnly(false);
    setSourceFilter("all");
    setTagFilters([]);
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }, []);

  /** Tag filter chip toggle — OR-semantics multi-select like the levels. */
  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilters((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setPage(0);
  }, []);

  // The tag chip row's options — every category in use with counts, loaded
  // once per mount (plus on vocab-updated, when a bulk edit may have added
  // categories). ~19 tags at 10k words, so no paging needed.
  const loadTagOptions = useCallback(async () => {
    setTagOptions(await db.listWordTags());
  }, [db]);
  useEffect(() => { void loadTagOptions(); }, [loadTagOptions]);

  // ── Multi-select (header actions: reanalyze / delete / mark status) ───
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /** Shift+click anchor (last plainly-toggled row) for range selection. */
  const rangeAnchorRef = useRef<number | null>(null);
  // Shift+click selects the whole span from the anchor to the clicked row —
  // file-manager semantics; triage over a page is click, shift-click, done.
  // The span is resolved on the CURRENT page's row order only: an anchor that
  // scrolled off belongs to a different filtered set and must not reach
  // across pages (a range is visually verifiable, a cross-page blast isn't).
  const toggleWordSelect = (id: number, range = false) => {
    const anchor = rangeAnchorRef.current;
    if (range && anchor !== null && anchor !== id) {
      const pageIds = words.map((w) => w.id);
      const a = pageIds.indexOf(anchor);
      const b = pageIds.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(pageIds[i]);
          return next;
        });
        rangeAnchorRef.current = id;
        return;
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    rangeAnchorRef.current = id;
  };
  const clearWordSelection = () => {
    setSelectedIds(new Set());
    rangeAnchorRef.current = null;
  };
  // "Select all" means the current page — the rest of the library stays
  // out of reach of bulk actions on purpose (10k accidental deletes, etc.).
  const selectAllWords = () => setSelectedIds(new Set(words.map((w) => w.id)));
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
      // Entering select mode on a word makes it the shift+click anchor.
      rangeAnchorRef.current = w.id;
    }
  };
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  // ── Star / status (optimistic — toggles should feel instant) ────────
  // A flag flip can push a row OUT of its live filter set (e.g. unstarring
  // under "starred only", or checking familiar under a "learning" chip) —
  // drop it from this page at once, like the old client-side filter did,
  // instead of leaving a stale row until the next reload.
  const removeIfFilteredOut = (w: WordListItem) => {
    const violatesStar = starredOnly && !w.starred;
    const violatesStatus = statusFilters.length > 0 && !statusFilters.includes(w.status);
    if (violatesStar || violatesStatus) {
      setWords((prev) => prev.filter((x) => x.id !== w.id));
      setTotal((n) => Math.max(0, n - 1));
    }
  };

  const toggleWordStar = async (id: number) => {
    const target = words.find((w) => w.id === id);
    if (!target) return;
    const next = !target.starred;
    const updated = { ...target, starred: next };
    setWords((prev) => prev.map((w) => (w.id === id ? updated : w)));
    removeIfFilteredOut(updated);
    const ok = await db.setWordStarred(id, next);
    if (!ok) setWords((prev) => prev.map((w) => (w.id === id ? { ...w, starred: !next } : w)));
  };

  /** Familiar checkbox per row: learning ↔ familiar; mastered → learning
   *  (mastered is earned through FSRS reviews — clicking it resets the word
   *  back into the pipeline). */
  const toggleWordStatus = async (id: number) => {
    const target = words.find((w) => w.id === id);
    if (!target) return;
    const next: WordStatus = target.status === "learning" ? "familiar" : "learning";
    const updated = { ...target, status: next };
    setWords((prev) => prev.map((w) => (w.id === id ? updated : w)));
    removeIfFilteredOut(updated);
    const ok = await db.setWordStatus(id, next);
    if (!ok) setWords((prev) => prev.map((w) => (w.id === id ? { ...w, status: target.status } : w)));
  };

  const [statusUpdating, setStatusUpdating] = useState(false);
  const markSelectedStatus = async (status: WordStatus) => {
    if (statusUpdating || selectedIds.size === 0) return;
    setStatusUpdating(true);
    const ok = await db.setWordsStatusBatch([...selectedIds], status);
    if (ok) {
      toast.success(t("vocab.wordsStatusUpdated", { n: selectedIds.size }));
      exitWordSelectMode();
      await loadWords();
    }
    setStatusUpdating(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadWords = useCallback(async () => {
    const res = await db.getWordsPage({
      search: debouncedSearch || undefined,
      levels: levelFilters,
      statuses: statusFilters,
      starred: starredOnly,
      enrichFilter,
      source: sourceFilter,
      tags: tagFilters,
      dueOnly,
      sortBy,
      sortDesc,
      dateField: "updated",
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize,
    });
    // Deleting/marking items off the end of a multi-page list can leave the
    // current page past the new total — walk back one page instead of showing
    // an empty screen whose pager disagrees with it.
    if (res.items.length === 0 && res.total > 0 && page > 0) {
      setLoaded(true);
      setPage(page - 1);
      return;
    }
    setWords(res.items);
    setTotal(res.total);
    // `?? null`, not an all-zero stand-in: a stale pre-facets core binary
    // must read as "counts unavailable" (hidden), never as "every pile is
    // empty" (zeros). This also keeps the bar useful during web/core version
    // skew across the four platforms.
    setFacets(res.facets ?? null);
    setLoaded(true);
  }, [db, debouncedSearch, levelFilters, statusFilters, starredOnly, enrichFilter, sourceFilter, tagFilters, dueOnly, sortBy, sortDesc, dateFrom, dateTo, page, pageSize]);

  useEffect(() => { void loadWords(); }, [loadWords]);

  const refreshList = async () => {
    await Promise.all([loadWords(), loadAllWordsStats(), loadTagOptions()]);
    toast.success(t("vocab.refreshed"));
  };

  // Aggregate vocabulary counts — the "re-analyze all" confirm count and the
  // header total read from here. Deliberately NOT a word-row dump: at 10k
  // words the old set cost a full-library payload per list mount.
  const [wordStats, setWordStats] = useState<{ total: number; unEnriched: number } | null>(null);
  const loadAllWordsStats = async () => {
    const stats = await db.getWordStats();
    if (stats) setWordStats({ total: stats.total, unEnriched: stats.unEnriched });
  };
  useEffect(() => { loadAllWordsStats(); }, []);

  useEffect(() => {
    const handler = () => { loadWords(); loadAllWordsStats(); };
    window.addEventListener("vocab-updated", handler);
    return () => window.removeEventListener("vocab-updated", handler);
  }, [loadWords]);

  // Adds from sibling windows / other surfaces never dispatch into this
  // document — the focus resync covers those paths (see useRefreshOnFocus).
  // Stats tag along so the header totals/agents count catch up too.
  useRefreshOnFocus(() => { loadWords(); loadAllWordsStats(); });

  // Server filter/paging means `words` IS the visible page — the alias keeps
  // the panel's prop name ("the rows to show", not "the whole library").
  const visibleWords = useMemo(() => words, [words]);

  // Dictionary behavior: the searched term isn't in the vocabulary → offer AI
  // lookup. Paged listing can no longer answer this from the current page's
  // rows, so it round-trips an exact-match COUNT instead.
  const [showAiLookup, setShowAiLookup] = useState(false);
  useEffect(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || !/^[a-z][a-z\s'-]*$/i.test(q)) {
      setShowAiLookup(false);
      return;
    }
    let cancelled = false;
    void db.wordExists(q).then((exists) => {
      if (!cancelled) setShowAiLookup(!exists);
    });
    return () => { cancelled = true; };
  }, [debouncedSearch, db]);

  /** Deep-link support: the target word's page index under the CURRENT sort,
   *  or null when it no longer exists. Uses the full-dump getWords because
   *  this probe is one-shot-only (deep links are rare) — under "due" sort the
   *  rank can't map to that command's orders, so it falls back to recent and
   *  the highlight may land a page off. */
  const findWordPage = useCallback(async (wordId: number): Promise<number | null> => {
    const all = await db.getWords({ sortBy: sortBy === "due" ? "recent" : sortBy });
    const idx = all.findIndex((w) => w.id === wordId);
    return idx < 0 ? null : Math.floor(idx / pageSize);
  }, [db, sortBy, pageSize]);

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
      await loadAllWordsStats();
    }
    setDeletingSelected(false);
    setDeleteSelectedOpen(false);
  };

  return {
    words, setWords, total, loaded, facets,
    levelFilters, setLevelFilters,
    statusFilters, setStatusFilters,
    starredOnly, setStarredOnly,
    enrichFilter, setEnrichFilter,
    dueOnly, setDueOnly,
    sourceFilter, setSourceFilter,
    tagFilters, toggleTagFilter, tagOptions, loadTagOptions,
    sortBy, changeSortBy, sortDesc, toggleSortDesc,
    search, setSearch,
    debouncedSearch,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    page, setPage,
    pageSize, changePageSize,
    clearAllFilters, findWordPage,
    selectMode, selectedIds,
    toggleWordSelect, clearWordSelection, selectAllWords, toggleWordSelectMode, exitWordSelectMode,
    handleWordDoubleClick,
    deleteSelectedOpen, setDeleteSelectedOpen, deletingSelected, deleteSelected,
    toggleWordStar, toggleWordStatus, markSelectedStatus, statusUpdating,
    loadWords, refreshList,
    wordStats, loadAllWordsStats,
    visibleWords, showAiLookup,
  };
}

export type VocabWordListState = ReturnType<typeof useVocabWordList>;
