import React, { useEffect, useState, useCallback } from "react";
import { useDB, DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { DocItem } from "./DocItem";
import { CloseIcon } from "@/components/ui/icons";
import { toast } from "sonner";

const PAGE_SIZE = 20;

interface Props {
  activeId: number | null;
  onSelect: (id: number) => void;
  onNewDoc: () => void;
  refreshKey: number;
}

export function DocSelector({ activeId, onSelect, onNewDoc, refreshKey }: Props) {
  const db = useDB();
  const t = useT();

  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("modified");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const result = await db.getDocuments({
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        tag: tagFilter || undefined,
        sort,
        page: p,
      });
      setDocs(result.items);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [search, sort, dateFrom, dateTo, tagFilter, page]);

  useEffect(() => { load(0); setPage(0); }, [search, sort, dateFrom, dateTo, tagFilter, refreshKey]);
  useEffect(() => { load(page); }, [page]);
  useEffect(() => { db.getAllTags().then(setAllTags); }, [refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleRename = async (id: number, title: string) => {
    const doc = await db.getDocument(id);
    if (!doc) return;
    await db.updateDocument(id, title, doc.content, "", doc.tags, doc.pinned, doc.word_count);
    load(page);
  };

  const handlePin = async (id: number) => {
    const doc = await db.getDocument(id);
    if (!doc) return;
    await db.updateDocument(id, doc.title, doc.content, "", doc.tags, !doc.pinned, doc.word_count);
    load(page);
  };

  const handleDuplicate = async (id: number) => {
    const newId = await db.duplicateDocument(id);
    load(page);
    onSelect(newId);
  };

  const handleDelete = async (id: number) => {
    const ok = window.confirm(t("doc.deleteConfirm"));
    if (!ok) return;
    await db.deleteDocument(id);
    toast.success(t("doc.delete"));
    load(page);
    if (activeId === id) onSelect(-1);
  };

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="flex flex-col h-full border-r border-border w-[260px] shrink-0 bg-sidebar">
      {/* Header */}
      <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Documents</p>
          <button
            onClick={onNewDoc}
            className="h-6 px-2.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90 transition-colors"
          >
            + {t("doc.newDoc")}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="9" r="5" />
            <path d="M13 13l3 3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("doc.search")}
            className="w-full h-7 pl-7 pr-2.5 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>

        {/* Sort + tag filter */}
        <div className="flex gap-1.5">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-none px-1.5"
          >
            <option value="modified">{t("doc.sortModified")}</option>
            <option value="created">{t("doc.sortCreated")}</option>
            <option value="title">{t("doc.sortTitle")}</option>
          </select>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-none px-1.5"
            >
              <option value="">{t("doc.allTags")}</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          )}
        </div>

        {/* Date range */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-none px-1.5 [color-scheme:dark] dark:[color-scheme:dark] [color-scheme:light] dark:[color-scheme:dark]"
            />
            <span className="text-[11px] text-muted-foreground shrink-0">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-none px-1.5"
            />
          </div>
          {hasDateFilter && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
            >
              {t("doc.clearDate")} <CloseIcon className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-1">
            <p className="text-sm">{t("doc.emptyState")}</p>
            <p className="text-xs opacity-60">{t("doc.emptyStateHint")}</p>
          </div>
        ) : (
          docs.map((doc) => (
            <DocItem
              key={doc.id}
              doc={doc}
              active={activeId === doc.id}
              onSelect={onSelect}
              onRename={handleRename}
              onPin={handlePin}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2.5 border-t border-border flex items-center justify-between shrink-0">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            ←
          </button>
          <span className="text-[10px] text-muted-foreground">
            {t("doc.page", { n: page + 1 })} / {totalPages}
            <span className="ml-1 opacity-60">({t("doc.total", { n: total })})</span>
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
