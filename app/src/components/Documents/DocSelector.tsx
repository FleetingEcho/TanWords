import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDB, DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { DocItem } from "./DocItem";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, ChevronsLeft, FilePlus2, Filter, LockKeyhole, Paperclip, Plus } from "lucide-react";
import { Download, FileInput, MoreHorizontal } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportMarkdownBundles, readMarkdownFiles } from "@/lib/localDocs";
import { getDocumentAssets, prepareDocumentAssetsForExport, rewriteDocumentLinksForExport } from "@/lib/documentAssets";
import { blocksToMarkdown, blocksToStorage, contentToBlocks, markdownToBlocks } from "@/lib/docFormat";
import { LIST_PANEL_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { ExportMarkdownDialog, MarkdownExportChoice } from "./ExportMarkdownDialog";
import { DocumentImageManager } from "./DocumentImageManager";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { DocumentPasswordDialog, type DocumentPasswordRequest } from "./DocumentPasswordDialog";

const PAGE_SIZE = 10_000;
type PrivatePasswordStatus = {
  configured: boolean;
  unlocked: boolean;
  legacy_documents: number;
};

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [exportChoices, setExportChoices] = useState<MarkdownExportChoice[] | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [normalOpen, setNormalOpen] = useState(() => localStorage.getItem("tanwords_docs_normal_open") !== "0");
  const [privateOpen, setPrivateOpen] = useState(() => localStorage.getItem("tanwords_docs_private_open") !== "0");
  const [shelfMenu, setShelfMenu] = useState<{ x: number; y: number; private: boolean } | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<DocumentPasswordRequest | null>(null);
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);

  const requestPassword = useCallback((request: DocumentPasswordRequest) => new Promise<string | null>((resolve) => {
    passwordResolver.current = resolve;
    setPasswordRequest(request);
  }), []);

  const finishPasswordRequest = (password: string | null) => {
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    setPasswordRequest(null);
    resolve?.(password);
  };

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

  // An outside agent can write documents through the MCP server while this
  // list is on screen (see hooks/useMcpSync) — reload rather than showing a
  // list that silently disagrees with the database.
  useEffect(() => {
    const onExternalChange = () => { void load(page); };
    window.addEventListener("docs-updated", onExternalChange);
    return () => window.removeEventListener("docs-updated", onExternalChange);
  }, [load, page]);
  useEffect(() => { db.getAllTags().then(setAllTags); }, [refreshKey]);
  useEffect(() => {
    if (!shelfMenu) return;
    const dismiss = () => setShelfMenu(null);
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [shelfMenu]);

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

  const passwordForPrivateDocument = async (): Promise<string | undefined | null> => {
    const status = await invoke<PrivatePasswordStatus>("db_private_password_status");
    if (status.configured && status.unlocked) return undefined;
    return requestPassword({
      title: status.configured ? t("doc.unlock") : t("doc.setPrivatePassword"),
      description: status.configured ? t("doc.sharedPasswordPrompt") : t("doc.sharedPasswordSetupHint"),
      confirm: !status.configured,
    });
  };

  const handlePrivacyAction = async (doc: DocumentListItem) => {
    if (doc.protected && !doc.unlocked) {
      onSelect(doc.id);
      return;
    }
    try {
      if (doc.protected) {
        await db.lockDocument(doc.id);
        if (activeId === doc.id) onSelect(doc.id);
      } else {
        const password = await passwordForPrivateDocument();
        if (password === null) return;
        await db.protectDocument(doc.id, password);
      }
      await load(page);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleRemoveProtection = async (doc: DocumentListItem) => {
    const password = await requestPassword({
      title: t("doc.removeProtection"),
      description: t("doc.passwordPrompt"),
    });
    if (!password) return;
    try {
      await db.removeDocumentProtection(doc.id, password);
      await load(page);
      if (activeId === doc.id) onSelect(doc.id);
    } catch {
      toast.error(t("doc.invalidPassword"));
    }
  };

  const handleNewPrivateDoc = async () => {
    const password = await passwordForPrivateDocument();
    if (password === null) return;
    let id = 0;
    try {
      id = await db.createDocument();
      if (!id) throw new Error(t("doc.privateCreateFailed"));
      await db.protectDocument(id, password);
      setPrivateOpen(true);
      localStorage.setItem("tanwords_docs_private_open", "1");
      await load(0);
      onSelect(id);
    } catch (error) {
      if (id) await db.deleteDocument(id);
      toast.error(String(error));
    }
  };

  const createInShelf = (privateShelf: boolean) => {
    setShelfMenu(null);
    if (privateShelf) void handleNewPrivateDoc();
    else onNewDoc();
  };

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
    try {
      const firstPage = await db.getDocuments({ sort: "title", page: 0 });
      const allDocuments = [...firstPage.items];
      for (let nextPage = 1; nextPage < Math.ceil(firstPage.total / PAGE_SIZE); nextPage += 1) {
        allDocuments.push(...(await db.getDocuments({ sort: "title", page: nextPage })).items);
      }
      for (const id of ids) {
        const listItem = allDocuments.find((document) => document.id === id);
        if (!listItem?.protected) continue;
        const password = await requestPassword({
          title: t("doc.exportMarkdown"),
          description: t("doc.exportPasswordPrompt", { title: listItem.title || t("doc.untitled") }),
        });
        if (!password) return;
        try {
          await db.unlockDocument(id, password);
        } catch {
          toast.error(t("doc.invalidPassword"));
          return;
        }
      }
      const destination = await openDialog({ directory: true, multiple: false });
      if (typeof destination !== "string") return;
      const files = [];
      for (const id of ids) {
        const detail = await db.getDocument(id);
        if (!detail) continue;
        const blocks = lowerMermaid(await contentToBlocks(detail.content));
        const markdown = await blocksToMarkdown(blocks);
        const prepared = prepareDocumentAssetsForExport(
          rewriteDocumentLinksForExport(markdown, allDocuments),
          await getDocumentAssets(id),
        );
        files.push({ name: `${detail.title || t("doc.untitled")}.md`, ...prepared });
      }
      const count = await exportMarkdownBundles(destination, files);
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
      setExportChoices(allDocs.filter((doc) => !doc.protected || doc.unlocked).map((doc) => ({
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
    <div className={`flex flex-col h-full border-r border-border ${LIST_PANEL_WIDTH} shrink-0 bg-transparent`}>
      {/* Header */}
      <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {onCollapse && (
              <Button variant="ghost" size="icon" onClick={onCollapse} className={`h-6 w-6 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("doc.collapseFiles")}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setImagesOpen(true)}
              className="h-6 w-6 text-muted-foreground hover:text-primary"
              title={t("doc.manageDatabaseImages")}
              aria-label={t("doc.manageDatabaseImages")}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
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

        {/* Sort + tag + date filters — collapsed by default, same pattern as
          * Vocabulary's LevelDateFilter, so the list gets more room by default. */}
        <div>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Filter className="w-3 h-3" />
            {t("doc.filters")}
            {(sort !== "modified" || tagFilter || dateFrom || dateTo) && (
              <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary">
                {[sort !== "modified", !!tagFilter, !!(dateFrom || dateTo)].filter(Boolean).length}
              </span>
            )}
            <svg viewBox="0 0 12 12" className={`w-2.5 h-2.5 shrink-0 transition-transform ${filtersOpen ? "rotate-90" : ""}`}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>

          {filtersOpen && (
            <div className="space-y-2 pt-2.5">
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

              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
                placeholder={t("doc.dateRangePlaceholder")}
                className="w-full"
              />
            </div>
          )}
        </div>
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">Loading…</div>
        ) : (
          <>
            {[
              { key: "normal", label: t("doc.normalGroup"), items: docs.filter((doc) => !doc.protected), open: normalOpen, setOpen: setNormalOpen },
              { key: "private", label: t("doc.privateGroup"), items: docs.filter((doc) => doc.protected), open: privateOpen, setOpen: setPrivateOpen },
            ].map((group) => (
              <div key={group.key} className="mb-1.5">
                <div
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setShelfMenu({ x: event.clientX, y: event.clientY, private: group.key === "private" });
                  }}
                  className="group/shelf flex w-full items-center px-1 pb-1 pt-1.5 text-muted-foreground"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const next = !group.open;
                      group.setOpen(next);
                      localStorage.setItem(`tanwords_docs_${group.key}_open`, next ? "1" : "0");
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] hover:text-foreground"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${group.open ? "" : "-rotate-90"}`} />
                    {group.key === "private" && <LockKeyhole className="h-3 w-3" />}
                    <span>{group.label}</span>
                    <span className="ml-auto min-w-5 rounded-full bg-muted px-1.5 py-px text-center tabular-nums text-muted-foreground">{group.items.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => createInShelf(group.key === "private")}
                    className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    title={group.key === "private" ? t("doc.newPrivateDoc") : t("doc.newDoc")}
                    aria-label={group.key === "private" ? t("doc.newPrivateDoc") : t("doc.newDoc")}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {group.open && group.items.map((doc) => (
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
              onPrivacyAction={(item) => void handlePrivacyAction(item)}
              onRemoveProtection={(item) => void handleRemoveProtection(item)}
            />
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {shelfMenu && (
        <div
          style={{ position: "fixed", left: shelfMenu.x, top: shelfMenu.y, zIndex: 9999 }}
          onMouseDown={(event) => event.stopPropagation()}
          className="min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <Button
            variant="ghost"
            onClick={() => createInShelf(shelfMenu.private)}
            className="h-8 w-full justify-start gap-2 px-2 text-xs"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            {shelfMenu.private ? t("doc.newPrivateDoc") : t("doc.newDoc")}
          </Button>
        </div>
      )}

      <DocumentPasswordDialog
        request={passwordRequest}
        onCancel={() => finishPasswordRequest(null)}
        onSubmit={(password) => finishPasswordRequest(password)}
      />

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

      <Dialog
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        maxWidth="max-w-[min(94vw,1280px)]"
        className="top-[4vh] h-[88vh] overflow-hidden"
      >
        <DialogTitle className="sr-only">{t("doc.manageDatabaseImages")}</DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setImagesOpen(false)}
          className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full bg-background/80 backdrop-blur"
          title={t("common.close")}
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
        <DocumentImageManager writable />
      </Dialog>

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
