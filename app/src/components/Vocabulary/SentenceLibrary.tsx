import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDB } from "@/hooks/useDB";
import type { SentenceItem } from "@/hooks/useDB.sentences";
import { useT } from "@/hooks/useT";
import { LevelFilter } from "@/components/shared/LevelDateFilter";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { analyzeSentence } from "@/features/patterns/generate";
import { SentenceList } from "./SentenceList";
import { SentenceModal } from "./SentenceModal";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const SENTENCE_PAGE_SIZE_KEY = "vocab-sentences-page-size";

/** Sentence library: a single full-width feed where clicking a row expands
 *  its detail inline (no side detail pane). Sentences are first-class rows —
 *  each is its own entry in the flat `sentences` table — added either one at
 *  a time (typed in, AI fills the translation/level) or generated in a batch
 *  for a word/topic. */
export function SentenceLibrary({ initialSentenceId, viewTabs }: {
  initialSentenceId?: number;
  /** The Words/Sentences switcher, handed down to the list to render as its
    *  heading — see VocabViewTabs. */
  viewTabs?: React.ReactNode;
}) {
  const db = useDB();
  const t = useT();

  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [starredOnly, setStarredOnly] = useState(false);
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

  const [deleteTarget, setDeleteTarget] = useState<SentenceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reanalyzingId, setReanalyzingId] = useState<number | null>(null);
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  // ── Multi-select (header action: delete selected) ──────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());
  const selectAll = () => setSelectedIds(new Set(visible.map((p) => p.id)));
  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    clearSelection();
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };
  // Double-click toggles select mode; entering it pre-selects the clicked sentence.
  const handleDoubleClick = (item: SentenceItem) => {
    if (selectMode) {
      exitSelectMode();
    } else {
      setSelectMode(true);
      setSelectedIds(new Set([item.id]));
    }
  };
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const load = () => db.listSentences().then(setSentences);
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [search, levelFilter, starredOnly, dateFrom, dateTo]);

  useEffect(() => {
    if (!initialSentenceId || sentences.length === 0) return;
    const index = sentences.findIndex((item) => item.id === initialSentenceId);
    if (index < 0) return;
    setSearch("");
    setLevelFilter("all");
    setStarredOnly(false);
    setDateFrom("");
    setDateTo("");
    setExpandedId(initialSentenceId);
    setPage(Math.floor(index / pageSize));
  }, [initialSentenceId, sentences.length, pageSize]);

  // Picks up sentences quick-added from the top CommandBar's SentenceSearchBox.
  useEffect(() => {
    window.addEventListener("sentences-updated", load);
    return () => window.removeEventListener("sentences-updated", load);
  }, []);

  // NOTE: the Words tab's "generate sentences" button no longer routes through
  // here. It opens the same modal from VocabularyPage instead, so asking a word
  // for examples stays on the Words tab rather than switching to this one.

  // Multi-token AND search: every whitespace-separated token must match
  // somewhere in the sentence bundle (sentence text, translation, note,
  // level, source) — so "simmer C1" or "煎熬 anger" narrow the list instead
  // of matching nothing as a literal substring.
  const searchTokens = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search]
  );

  const visible = useMemo(() => {
    return sentences.filter((item) => {
      if (searchTokens.length > 0) {
        const hay = `${item.sentence} ${item.zh} ${item.note} ${item.level ?? ""} ${item.source}`.toLowerCase();
        if (!searchTokens.every((tk) => hay.includes(tk))) return false;
      }
      if (levelFilter !== "all") {
        if (levelFilter === "B1-" ? !["B1", "A2", "A1"].includes(item.level ?? "") : item.level !== levelFilter) return false;
      }
      if (starredOnly && !item.starred) return false;
      if (dateFrom && item.updated_at < dateFrom) return false;
      if (dateTo && item.updated_at > `${dateTo} 23:59:59`) return false;
      return true;
    });
  }, [sentences, searchTokens, levelFilter, starredOnly, dateFrom, dateTo]);

  // Deleting the last item of the last page must not leave an empty page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [visible.length, page, pageSize]);

  // Dedup set for the generate flow — every sentence already in the library.
  const existingSentences = useMemo(() => sentences.map((s) => s.sentence), [sentences]);

  // Optimistic star toggle, mirroring the Words tab's toggleWordStar.
  const toggleStar = async (id: number) => {
    const target = sentences.find((p) => p.id === id);
    if (!target) return;
    const next = !target.starred;
    setSentences((prev) => prev.map((p) => (p.id === id ? { ...p, starred: next } : p)));
    const ok = await db.setSentenceStarred(id, next);
    if (!ok) setSentences((prev) => prev.map((p) => (p.id === id ? { ...p, starred: !next } : p)));
  };

  // Re-runs the quick-add analysis on an already-saved sentence and overwrites
  // its translation / note / level — for rows saved before analysis existed, or
  // where the model's first pass was off. (The analysis may also produce a
  // reusable pattern skeleton, but the new flat-sentence model no longer
  // stores one, so only zh/note/level are written back.)
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
      setDeleteTarget(null);
      await load();
      window.dispatchEvent(new CustomEvent("sentences-updated"));
    }
    setDeleting(false);
  };

  // Sequentially re-runs analysis on every selected sentence — same per-item
  // logic as `reanalyze`, just looped, since there's no batch endpoint for it.
  // Exits select mode up front (mirrors the Words tab's reanalyzeSelected) so
  // the toolbar doesn't linger showing a stale selection while this runs.
  const reanalyzeSelected = async () => {
    if (reanalyzingId !== null) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }
    const targets = sentences.filter((p) => selectedIds.has(p.id));
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
    }
    if (done > 0) {
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
      setSentences((prev) => prev.filter((s) => !deletedIds.has(s.id)));
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
        items={visible}
        expandedId={expandedId}
        highlightId={initialSentenceId}
        search={search}
        searchTokens={searchTokens}
        levelFilter={levelFilter}
        starredOnly={starredOnly}
        dateFrom={dateFrom}
        dateTo={dateTo}
        page={page}
        pageSize={pageSize}
        onSearchChange={setSearch}
        onLevelFilterChange={setLevelFilter}
        onStarredOnlyChange={setStarredOnly}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onToggleExpand={(item) => setExpandedId((prev) => (prev === item.id ? null : item.id))}
        onDoubleClick={handleDoubleClick}
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
        onAdded={() => { load(); window.dispatchEvent(new CustomEvent("sentences-updated")); }}
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
