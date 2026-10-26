import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDB } from "@/hooks/useDB";
import type { SentenceFacets, SentenceItem, SentenceSortBy } from "@/hooks/useDB.sentences";
import { useT } from "@/hooks/useT";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";
import type { LevelValue } from "@/components/shared/LevelDateFilter";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { analyzeSentence } from "@/features/patterns/generate";
import { SentenceList } from "./SentenceList";
import { SentenceModal } from "./SentenceModal";
import { loadSentenceFilters, persistSentenceFilters } from "./filters/sentenceFilterDefs";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500, 1000] as const;
const SENTENCE_PAGE_SIZE_KEY = "vocab-sentences-page-size";

/** Sentence library: a single full-width feed where clicking a row expands
 *  its detail inline (no side detail pane). Sentences are first-class rows —
 *  each is its own entry in the flat `sentences` table — added either one at
 *  a time (typed in, AI fills the translation/level) or generated in a batch
 *  for a word/topic.
 *
 *  Listing is server-paged (db_get_sentences_page): filters run in SQL, chip
 *  counts arrive as facets on the same round trip, and the filter working set
 *  persists between sessions (filters/sentenceFilterDefs.ts). */
export function SentenceLibrary({ initialSentenceId, viewTabs }: {
  initialSentenceId?: number;
  /** The Words/Sentences switcher, handed down to the list to render as its
   *  heading — see VocabViewTabs. */
  viewTabs?: React.ReactNode;
}) {
  const db = useDB();
  const t = useT();

  const [items, setItems] = useState<SentenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** Chip counts from the page query; null against a stale pre-facets core. */
  const [facets, setFacets] = useState<SentenceFacets | null>(null);

  // ── Filters & sort — persisted working set (search/dates excluded by design)
  const [initialFilters] = useState(loadSentenceFilters);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [levels, setLevels] = useState<LevelValue[]>(initialFilters.levels);
  const [starredOnly, setStarredOnly] = useState(initialFilters.starredOnly);
  const [sourceFilter, setSourceFilter] = useState(initialFilters.source);
  const [sortBy, setSortBy] = useState<SentenceSortBy>(initialFilters.sortBy);
  const [sortDesc, setSortDesc] = useState(initialFilters.sortDesc);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(SENTENCE_PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(saved as (typeof PAGE_SIZE_OPTIONS)[number]) ? saved : 20;
  });
  const changePageSize = (next: number) => {
    setPageSize(next);
    setPage(0);
    localStorage.setItem(SENTENCE_PAGE_SIZE_KEY, String(next));
  };
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "generate">("generate");
  const [modalSeed, setModalSeed] = useState<string | null>(null);
  const [existingSentences, setExistingSentences] = useState<string[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<SentenceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reanalyzingId, setReanalyzingId] = useState<number | null>(null);
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  // ── Multi-select (header actions: delete / reanalyze selected) ──────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /** Shift+click anchor — same range-select semantics as the words list. */
  const rangeAnchorRef = useRef<number | null>(null);
  const toggleSelect = (id: number, range = false) => {
    const anchor = rangeAnchorRef.current;
    if (range && anchor !== null && anchor !== id) {
      const pageIds = items.map((s) => s.id);
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
  const clearSelection = () => {
    setSelectedIds(new Set());
    rangeAnchorRef.current = null;
  };
  const selectAll = () => setSelectedIds(new Set(items.map((p) => p.id)));
  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };
  // Double-click toggles select mode; entering it pre-selects the sentence.
  const handleDoubleClick = (item: SentenceItem) => {
    if (selectMode) {
      exitSelectMode();
    } else {
      setSelectMode(true);
      setSelectedIds(new Set([item.id]));
      rangeAnchorRef.current = item.id;
    }
  };
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  // ── Server-paged loading ────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    persistSentenceFilters({ levels, starredOnly, source: sourceFilter, sortBy, sortDesc });
  }, [levels, starredOnly, sourceFilter, sortBy, sortDesc]);

  // Any filter edit restarts paging from zero (server-side filters make a
  // mid-set page meaningless).
  useEffect(() => { setPage(0); }, [debouncedSearch, levels, starredOnly, sourceFilter, dateFrom, dateTo, sortBy, sortDesc]);

  const load = useCallback(async () => {
    const res = await db.getSentencesPage({
      search: debouncedSearch || undefined,
      levels,
      starred: starredOnly,
      source: sourceFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sortBy,
      sortDesc,
      page,
      pageSize,
    });
    setItems(res.items);
    setTotal(res.total);
    setFacets(res.facets ?? null);
    setLoaded(true);
  }, [db, debouncedSearch, levels, starredOnly, sourceFilter, dateFrom, dateTo, sortBy, sortDesc, page, pageSize]);
  useEffect(() => { void load(); }, [load]);

  // Deleting/filtering the last item off the last page must not strand an
  // empty page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [total, page, pageSize]);

  // Picks up sentences quick-added from the top CommandBar's SentenceSearchBox.
  useEffect(() => {
    const handler = () => { void load(); };
    window.addEventListener("sentences-updated", handler);
    return () => window.removeEventListener("sentences-updated", handler);
  }, [load]);

  // Adds from sibling windows / other surfaces never dispatch into this
  // document — the focus resync covers those paths (see useRefreshOnFocus).
  useRefreshOnFocus(() => { void load(); });

  // The generate modal dedupes against the whole library; load that snapshot
  // only when the modal opens (server paging means `items` is just a page).
  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    void db.listSentences().then((all) => {
      if (!cancelled) setExistingSentences(all.map((s) => s.sentence));
    });
    return () => { cancelled = true; };
  }, [modalOpen, db]);

  /** Resets every filter/sort at once (the bar's clear-all). */
  const clearAllFilters = () => {
    setSearch("");
    setLevels([]);
    setStarredOnly(false);
    setSourceFilter("all");
    setSortBy("recent");
    setSortDesc(true);
    setDateFrom("");
    setDateTo("");
  };

  // One-shot deep-link: clear the working set, then compute the target's
  // page under the CURRENT sort from a full-list probe (same one-shot trick
  // as the words tab's findWordPage — rare by definition).
  const didInitialJumpRef = useRef(false);
  useEffect(() => {
    if (!initialSentenceId || didInitialJumpRef.current || !loaded) return;
    didInitialJumpRef.current = true;
    if (items.some((i) => i.id === initialSentenceId)) {
      setExpandedId(initialSentenceId);
      return;
    }
    void db.listSentences().then((all) => {
      const ordered =
        sortBy === "alpha"
          ? [...all].sort((a, b) => {
              const cmp = a.sentence.toLowerCase().localeCompare(b.sentence.toLowerCase()) || a.id - b.id;
              return sortDesc ? -cmp : cmp;
            })
          : all; // db_list_sentences is created_at DESC, id DESC — the "recent" order
      const idx = ordered.findIndex((i) => i.id === initialSentenceId);
      if (idx < 0) return;
      setSearch("");
      setLevels([]);
      setStarredOnly(false);
      setSourceFilter("all");
      setDateFrom("");
      setDateTo("");
      setPage(Math.floor(idx / pageSize));
      setExpandedId(initialSentenceId);
    });
  }, [initialSentenceId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps -- once per incoming deep-link id

  // Multi-token AND search tokens for row highlighting (server matches the
  // same tokens across sentence/zh/note/source).
  const searchTokens = useMemo(
    () => debouncedSearch.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [debouncedSearch]
  );

  const anyFilterActive =
    searchTokens.length > 0 || levels.length > 0 || starredOnly || sourceFilter !== "all" || !!dateFrom || !!dateTo;

  // Optimistic star toggle, mirroring the Words tab's toggleWordStar.
  const toggleStar = async (id: number) => {
    const target = items.find((p) => p.id === id);
    if (!target) return;
    const next = !target.starred;
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, starred: next } : p)));
    const ok = await db.setSentenceStarred(id, next);
    if (!ok) setItems((prev) => prev.map((p) => (p.id === id ? { ...p, starred: !next } : p)));
    else if (starredOnly && !next) setItems((prev) => prev.filter((p) => p.id !== id)); // falls out of the live filter
  };

  // Re-runs the quick-add analysis on an already-saved sentence and overwrites
  // its translation / note / level — for rows saved before analysis existed, or
  // where the model's first pass was off.
  const reanalyze = async (item: SentenceItem) => {
    if (reanalyzingId !== null) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }
    const sentence = item.sentence;
    setReanalyzingId(item.id);
    try {
      const result = await analyzeSentence(provider, sentence, targetLevel);
      if (!result.zh.trim()) {
        toast.error(t("vocab.sentences.reanalyzeFailed"));
        return;
      }
      const ok = await db.updateSentence(item.id, result.zh, result.note, result.level);
      if (ok) {
        toast.success(t("vocab.sentences.reanalyzed"));
        await load();
        window.dispatchEvent(new CustomEvent("sentences-updated"));
      }
    } catch {
      toast.error(t("vocab.sentences.reanalyzeFailed"));
    } finally {
      setReanalyzingId(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const deleted = await db.deleteSentence(deleteTarget.id);
    if (deleted) {
      toast.success(t("vocab.sentences.deleted"));
      if (expandedId === deleteTarget.id) setExpandedId(null);
      setItems((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setDeleteTarget(null);
      window.dispatchEvent(new CustomEvent("sentences-updated"));
    }
    setDeleting(false);
  };

  // Sequentially re-runs analysis on every selected sentence — same per-item
  // logic as `reanalyze`, just looped, since there's no batch endpoint for it.
  const reanalyzeSelected = async () => {
    if (reanalyzingId !== null) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }
    const targets = items.filter((p) => selectedIds.has(p.id));
    exitSelectMode();
    let done = 0;
    let failed = 0;
    for (const item of targets) {
      setReanalyzingId(item.id);
      try {
        const sentence = item.sentence;
        const result = await analyzeSentence(provider, sentence, targetLevel);
        if (!result.zh.trim()) { failed++; continue; }
        const ok = await db.updateSentence(item.id, result.zh, result.note, result.level);
        ok ? done++ : failed++;
      } catch {
        failed++;
      }
    }
    setReanalyzingId(null);
    if (done > 0) {
      await load();
      window.dispatchEvent(new CustomEvent("sentences-updated"));
      toast.success(t("vocab.sentences.reanalyzeSelectedDone", { done }) + (failed > 0 ? t("vocab.bulkEnrichFailedSuffix", { failed }) : ""));
    } else {
      toast.error(t("vocab.sentences.reanalyzeFailed"));
    }
  };

  const deleteSelected = async () => {
    if (deletingSelected) return;
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setDeleteSelectedOpen(false);
      return;
    }

    // Close the blocking dialog before doing I/O. A slow database or network
    // must never trap the whole page behind an unresponsive modal.
    setDeleteSelectedOpen(false);
    setDeletingSelected(true);
    try {
      const deleted = await db.deleteSentencesBatch(ids);
      if (!deleted) return;

      const deletedIds = new Set(ids);
      setItems((prev) => prev.filter((s) => !deletedIds.has(s.id)));
      setTotal((prev) => Math.max(0, prev - ids.length));
      if (expandedId !== null && deletedIds.has(expandedId)) setExpandedId(null);
      exitSelectMode();
      toast.success(t("vocab.sentences.selectedDeleted", { n: ids.length }));
      window.dispatchEvent(new CustomEvent("sentences-updated"));
    } finally {
      setDeletingSelected(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <SentenceList
        viewTabs={viewTabs}
        items={items}
        total={total}
        facets={facets}
        filteredToEmpty={loaded && items.length === 0 && anyFilterActive}
        expandedId={expandedId}
        highlightId={initialSentenceId}
        search={search}
        searchTokens={searchTokens}
        levels={levels}
        starredOnly={starredOnly}
        source={sourceFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        sortBy={sortBy}
        sortDesc={sortDesc}
        page={page}
        pageSize={pageSize}
        onSearchChange={setSearch}
        onLevelsChange={setLevels}
        onStarredOnlyChange={setStarredOnly}
        onSourceChange={setSourceFilter}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onSortChange={setSortBy}
        onSortDescToggle={() => setSortDesc((v) => !v)}
        onClearAllFilters={clearAllFilters}
        onToggleExpand={(item) => setExpandedId((prev) => (prev === item.id ? null : item.id))}
        onDoubleClick={handleDoubleClick}
        onRefresh={() => void load()}
        onPageChange={setPage}
        onPageSizeChange={changePageSize}
        onOpenAdd={() => { setModalMode("add"); setModalSeed(null); setModalOpen(true); }}
        onOpenGenerate={() => { setModalMode("generate"); setModalSeed(null); setModalOpen(true); }}
        onRequestDelete={(item) => setDeleteTarget(item)}
        onReanalyze={reanalyze}
        reanalyzingId={reanalyzingId}
        onToggleStar={toggleStar}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onDeleteSelected={() => setDeleteSelectedOpen(true)}
        onReanalyzeSelected={reanalyzeSelected}
      />

      <SentenceModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setModalSeed(null); }}
        initialMode={modalMode}
        initialQuery={modalSeed}
        existingSentences={existingSentences}
        onAdded={() => { void load(); window.dispatchEvent(new CustomEvent("sentences-updated")); }}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={t("vocab.sentences.delete")}
        message={t("vocab.sentences.deleteConfirm", { name: deleteTarget?.sentence ?? "" })}
        confirmLabel={deleting ? t("vocab.sentences.deleting") : t("vocab.sentences.delete")}
        confirmDisabled={deleting}
        onConfirm={remove}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />

      <ConfirmModal
        open={deleteSelectedOpen}
        title={t("vocab.sentences.deleteSelectedConfirmTitle", { n: selectedIds.size })}
        message={t("vocab.sentences.deleteSelectedConfirmMessage")}
        confirmLabel={deletingSelected ? t("vocab.sentences.deleting") : t("vocab.sentences.deleteSelectedConfirmConfirm")}
        confirmDisabled={deletingSelected}
        danger
        onConfirm={deleteSelected}
        onCancel={() => !deletingSelected && setDeleteSelectedOpen(false)}
      />
    </div>
  );
}
