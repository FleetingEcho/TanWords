import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDB } from "@/hooks/useDB";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { LevelFilter } from "@/components/shared/LevelDateFilter";
import { SentenceListPanel } from "./SentenceListPanel";
import { SentenceDetailPanel } from "./SentenceDetailPanel";
import { SentenceModal } from "./SentenceModal";

const PAGE_SIZE = 20;

/** Sentence library: list + detail, mirroring the Words tab. Sentences are
 *  added either one at a time (typed in, AI fills the translation/level/
 *  pattern) or generated in a batch for a word/topic — both save through
 *  the existing patterns + pattern_examples tables (no schema change; a
 *  "pattern" row already is a phrase/translation/note/level bundle with one
 *  saved example sentence, which is exactly what a flat sentence library
 *  needs). */
export function PatternLibrary({ initialQuery, onSeedConsumed }: { initialQuery?: string | null; onSeedConsumed?: () => void }) {
  const db = useDB();
  const t = useT();

  const [patterns, setPatterns] = useState<PatternItem[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "generate">("generate");
  const [modalSeed, setModalSeed] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PatternItem | null>(null);
  const [deleting, setDeleting] = useState(false);

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
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const load = () => db.listPatterns().then(setPatterns);
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [search, levelFilter, dateFrom, dateTo]);

  // Picks up sentences quick-added from the top CommandBar's SentenceSearchBox.
  useEffect(() => {
    window.addEventListener("patterns-updated", load);
    return () => window.removeEventListener("patterns-updated", load);
  }, []);

  // A word picked in the Words tab ("generate sentences" button) seeds a run.
  useEffect(() => {
    if (!initialQuery?.trim()) return;
    setModalMode("generate");
    setModalSeed(initialQuery);
    setModalOpen(true);
    onSeedConsumed?.();
  }, [initialQuery]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return patterns.filter((item) => {
      if (query && !`${item.pattern} ${item.zh} ${item.note} ${item.examples.map((e) => e.sentence).join(" ")}`.toLowerCase().includes(query)) return false;
      if (levelFilter !== "all") {
        if (levelFilter === "B1-" ? !["B1", "A2", "A1"].includes(item.level ?? "") : item.level !== levelFilter) return false;
      }
      if (dateFrom && item.created_at < dateFrom) return false;
      if (dateTo && item.created_at > `${dateTo} 23:59:59`) return false;
      return true;
    });
  }, [patterns, search, levelFilter, dateFrom, dateTo]);

  // Deleting the last item of the last page must not leave an empty page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [visible.length, page]);

  // Default to the first item once the list loads, like the Words tab does.
  useEffect(() => {
    if (selectedId === null && visible.length > 0) setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  const selected = patterns.find((p) => p.id === selectedId) ?? null;

  // Dedup set for the generate flow — every sentence already in the library.
  const existingSentences = useMemo(() => patterns.flatMap((p) => p.examples.map((e) => e.sentence)), [patterns]);

  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const deleted = await db.deletePattern(deleteTarget.id);
    if (deleted) {
      toast.success(t("vocab.patterns.deleted"));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      await load();
      window.dispatchEvent(new CustomEvent("patterns-updated"));
    }
    setDeleting(false);
  };

  const deleteSelected = async () => {
    if (deletingSelected) return;
    setDeletingSelected(true);
    const results = await Promise.all([...selectedIds].map((id) => db.deletePattern(id)));
    const deletedCount = results.filter(Boolean).length;
    if (deletedCount > 0) {
      toast.success(t("vocab.patterns.selectedDeleted", { n: deletedCount }));
      if (selectedId !== null && selectedIds.has(selectedId)) setSelectedId(null);
      exitSelectMode();
      await load();
      window.dispatchEvent(new CustomEvent("patterns-updated"));
    }
    setDeletingSelected(false);
    setDeleteSelectedOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <SentenceListPanel
        items={visible}
        selectedId={selectedId}
        search={search}
        levelFilter={levelFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        page={page}
        pageSize={PAGE_SIZE}
        onSearchChange={setSearch}
        onLevelFilterChange={setLevelFilter}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onSelect={(item) => setSelectedId(item.id)}
        onPageChange={setPage}
        onOpenAdd={() => { setModalMode("add"); setModalSeed(null); setModalOpen(true); }}
        onOpenGenerate={() => { setModalMode("generate"); setModalSeed(null); setModalOpen(true); }}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onDeleteSelected={() => setDeleteSelectedOpen(true)}
      />

      <SentenceDetailPanel
        selected={selected}
        onRequestDelete={() => selected && setDeleteTarget(selected)}
      />

      <SentenceModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setModalSeed(null); }}
        initialMode={modalMode}
        initialQuery={modalSeed}
        existingSentences={existingSentences}
        onAdded={() => { load(); window.dispatchEvent(new CustomEvent("patterns-updated")); }}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={t("vocab.patterns.delete")}
        message={t("vocab.patterns.deleteConfirm", { name: deleteTarget?.pattern ?? "" })}
        confirmLabel={deleting ? t("vocab.patterns.deleting") : t("vocab.patterns.delete")}
        confirmDisabled={deleting}
        onConfirm={remove}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />

      <ConfirmModal
        open={deleteSelectedOpen}
        title={t("vocab.patterns.deleteSelectedConfirmTitle", { n: selectedIds.size })}
        message={t("vocab.patterns.deleteSelectedConfirmMessage")}
        confirmLabel={deletingSelected ? t("vocab.patterns.deleting") : t("vocab.patterns.deleteSelectedConfirmConfirm")}
        confirmDisabled={deletingSelected}
        danger
        onConfirm={deleteSelected}
        onCancel={() => !deletingSelected && setDeleteSelectedOpen(false)}
      />
    </div>
  );
}
