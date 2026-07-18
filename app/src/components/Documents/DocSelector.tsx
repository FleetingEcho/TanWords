import React, { useEffect, useState, useCallback } from "react";
import { useDB, DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { DocItem } from "./DocItem";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { PanelLeftClose } from "lucide-react";
import { Download, FileInput, MoreHorizontal } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportMarkdownFiles, readMarkdownFiles } from "@/lib/localDocs";
import { blocksToMarkdown, blocksToStorage, contentToBlocks, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { ExportMarkdownDialog, MarkdownExportChoice } from "./ExportMarkdownDialog";

const PAGE_SIZE = 20;

interface Props {
  activeId: number | null;
  onSelect: (id: number) => void;
  onNewDoc: () => void;
  refreshKey: number;
  onCollapse?: () => void;
}

export function DocSelector({ activeId, onSelect, onNewDoc, refreshKey, onCollapse }: Props) {
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
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [exportChoices, setExportChoices] = useState<MarkdownExportChoice[] | null>(null);

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
    await db.updateDocument(id, title, doc.content, doc.content_text, doc.tags, doc.pinned, doc.word_count);
    load(page);
  };

  const handlePin = async (id: number) => {
    const doc = await db.getDocument(id);
    if (!doc) return;
    await db.updateDocument(id, doc.title, doc.content, doc.content_text, doc.tags, !doc.pinned, doc.word_count);
    load(page);
  };

  const handleDuplicate = async (id: number) => {
    const newId = await db.duplicateDocument(id);
    load(page);
    onSelect(newId);
  };

  const handleDelete = (id: number) => setPendingDeleteId(id);

  const handleImport = async () => {
    const picked = await openDialog({ multiple: true, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
    const paths = typeof picked === "string" ? [picked] : picked;
    if (!paths?.length) return;
    try {
      const sources = await readMarkdownFiles(paths);
      let firstImportedId: number | null = null;
      for (const source of sources) {
        const blocks = liftMermaid(await markdownToBlocks(source.content));
        const { content, contentText, wordCount } = blocksToStorage(blocks);
        const id = await db.createDocument();
        if (firstImportedId === null) firstImportedId = id;
        const title = source.name.replace(/\.(md|markdown)$/i, "");
        await db.updateDocument(id, title, content, contentText, "[]", false, wordCount);
      }
      await load(0);
      if (firstImportedId !== null) onSelect(firstImportedId);
      toast.success(t("doc.importedCount", { n: sources.length }));
    } catch (error) { toast.error(String(error)); }
  };

  const exportDocuments = async (ids: number[]) => {
    const destination = await openDialog({ directory: true, multiple: false });
    if (typeof destination !== "string") return;
    try {
      const files = [];
      for (const id of ids) {
        const detail = await db.getDocument(id);
        if (!detail) continue;
        const blocks = lowerMermaid(await contentToBlocks(detail.content));
        files.push({ name: `${detail.title || t("doc.untitled")}.md`, content: await blocksToMarkdown(blocks) });
      }
      const count = await exportMarkdownFiles(destination, files);
      toast.success(t("doc.exportedCount", { n: count }));
    } catch (error) { toast.error(String(error)); }
  };

  const handleExportAll = async () => {
    try {
      const firstPage = await db.getDocuments({ sort: "title", page: 0 });
      const allDocs = [...firstPage.items];
      const pageCount = Math.ceil(firstPage.total / PAGE_SIZE);
      for (let nextPage = 1; nextPage < pageCount; nextPage += 1) {
        const result = await db.getDocuments({ sort: "title", page: nextPage });
        allDocs.push(...result.items);
      }
      setExportChoices(allDocs.map((doc) => ({
        id: String(doc.id),
        label: doc.title || t("doc.untitled"),
        detail: doc.content_text.slice(0, 100),
        searchText: doc.content_text,
      })));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (id === null) return;
    setPendingDeleteId(null);
    await db.deleteDocument(id);
    toast.success(t("doc.delete"));
    load(page);
    if (activeId === id) onSelect(-1);
  };

  return (
    <div className="flex flex-col h-full border-r border-border w-80 shrink-0 bg-sidebar">
      {/* Header */}
      <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {onCollapse && (
              <Button variant="ghost" size="icon" onClick={onCollapse} className="h-6 w-6" title={t("doc.collapseFiles")}>
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button onClick={onNewDoc} className="h-6 px-2.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90">+ {t("doc.newDoc")}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void handleImport()}><FileInput className="h-3.5 w-3.5" /> {t("doc.importMarkdown")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleExportAll()}><Download className="h-3.5 w-3.5" /> {t("doc.exportAllMarkdown")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-none px-1.5 gap-1 [&_svg]:h-3 [&_svg]:w-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modified">{t("doc.sortModified")}</SelectItem>
              <SelectItem value="created">{t("doc.sortCreated")}</SelectItem>
              <SelectItem value="title">{t("doc.sortTitle")}</SelectItem>
            </SelectContent>
          </Select>
          {allTags.length > 0 && (
            <Select value={tagFilter || "__all__"} onValueChange={(v) => setTagFilter(v === "__all__" ? "" : v)}>
              <SelectTrigger className="flex-1 h-6 text-[11px] rounded-lg border border-border bg-card text-foreground focus:outline-none px-1.5 gap-1 [&_svg]:h-3 [&_svg]:w-3">
                <SelectValue placeholder={t("doc.allTags")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("doc.allTags")}</SelectItem>
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Date range */}
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
          placeholder={t("doc.dateRangePlaceholder")}
          className="w-full"
        />
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
              searchQuery={search}
              onExport={(id) => void exportDocuments([id])}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2.5 border-t border-border flex items-center justify-between shrink-0">
          <Button
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-auto text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            ←
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {t("doc.page", { n: page + 1 })} / {totalPages}
            <span className="ml-1 opacity-60">({t("doc.total", { n: total })})</span>
          </span>
          <Button
            variant="ghost"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="h-auto text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            →
          </Button>
        </div>
      )}

      <ConfirmModal
        open={pendingDeleteId !== null}
        title={t("doc.deleteDocTitle")}
        message={t("doc.deleteConfirm")}
        confirmLabel={t("doc.delete")}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={confirmDelete}
      />
      <ExportMarkdownDialog
        open={exportChoices !== null}
        items={exportChoices ?? []}
        onClose={() => setExportChoices(null)}
        onExport={(ids) => {
          setExportChoices(null);
          void exportDocuments(ids.map(Number));
        }}
      />
    </div>
  );
}
