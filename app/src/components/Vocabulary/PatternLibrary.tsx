import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDB } from "@/hooks/useDB";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
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
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "generate">("generate");
  const [modalSeed, setModalSeed] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PatternItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => db.listPatterns().then(setPatterns);
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [search]);

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
    if (!query) return patterns;
    return patterns.filter((item) =>
      `${item.pattern} ${item.zh} ${item.note} ${item.examples.map((e) => e.sentence).join(" ")}`.toLowerCase().includes(query));
  }, [patterns, search]);

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
    }
    setDeleting(false);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <SentenceListPanel
        items={visible}
        selectedId={selectedId}
        search={search}
        page={page}
        pageSize={PAGE_SIZE}
        onSearchChange={setSearch}
        onSelect={(item) => setSelectedId(item.id)}
        onPageChange={setPage}
        onOpenAdd={() => { setModalMode("add"); setModalSeed(null); setModalOpen(true); }}
        onOpenGenerate={() => { setModalMode("generate"); setModalSeed(null); setModalOpen(true); }}
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
        onAdded={load}
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
    </div>
  );
}
