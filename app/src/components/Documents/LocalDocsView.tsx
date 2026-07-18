import React, { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import {
  LOCAL_DOCS_ROOT_KEY,
  LocalDocItem,
  LocalDocSearchResult,
  createLocalDoc,
  deleteLocalDoc,
  listLocalDocs,
  mdFromDisplay,
  mdToDisplay,
  moveLocalDoc,
  readLocalDoc,
  renameLocalDoc,
  searchLocalDocs,
  writeLocalDoc,
  importLocalDocs,
  exportLocalDocs,
} from "@/lib/localDocs";
import { LazyLocalDocEditor } from "./LazyLocalDocEditor";
import { LocalDocTree } from "./LocalDocTree";
import { SaveStatus } from "./useDocumentEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, FileInput, FileText, FolderOpen, Loader2, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { blocksToStorage, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid } from "./mermaidTransforms";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportMarkdownDialog } from "./ExportMarkdownDialog";

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (needle && index >= 0) {
    parts.push(text.slice(cursor, index));
    parts.push(<mark key={index} className="rounded-sm bg-yellow-300/70 px-0.5 text-inherit dark:bg-yellow-500/40">{text.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function HighlightFuzzy({ text, query }: { text: string; query: string }) {
  const chars = [...text];
  const needle = [...query.trim().toLowerCase()];
  const matched = new Set<number>();
  let cursor = 0;
  for (const target of needle) {
    const index = chars.findIndex((char, i) => i >= cursor && char.toLowerCase() === target);
    if (index < 0) return <>{text}</>;
    matched.add(index);
    cursor = index + 1;
  }
  return <>{chars.map((char, index) => matched.has(index)
    ? <mark key={index} className="rounded-sm bg-yellow-300/70 text-inherit dark:bg-yellow-500/40">{char}</mark>
    : char)}</>;
}

function SearchResults({ results, query, activePath, onOpen }: {
  results: LocalDocSearchResult[];
  query: string;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  return <div className="space-y-1.5">
    {results.map((result) => (
      <Button
        key={result.rel_path}
        type="button"
        variant="ghost"
        onClick={() => onOpen(result.rel_path)}
        className={`h-auto w-full items-start justify-start gap-2 px-2 py-2 text-left ${activePath === result.rel_path ? "bg-primary/10" : ""}`}
      >
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium"><HighlightFuzzy text={result.name.replace(/\.(md|markdown)$/i, "")} query={query} /></span>
          <span className="block truncate text-[10px] font-normal text-muted-foreground"><HighlightFuzzy text={result.rel_path} query={query} /></span>
          {result.hits.map((hit) => (
            <span key={`${hit.line_number}-${hit.line_text}`} className="mt-1 block line-clamp-2 whitespace-normal text-[11px] font-normal leading-4 text-muted-foreground">
              <span className="mr-1 font-mono opacity-50">{hit.line_number}</span>
              <HighlightMatch text={hit.line_text} query={query} />
            </span>
          ))}
        </span>
      </Button>
    ))}
  </div>;
}

/** The "local folder" source of the Documents page: mount a folder, then
 *  list/edit/create/delete the markdown files inside it. */
export function LocalDocsView() {
  const db = useDB();
  const t = useT();

  const [root, setRoot] = useState<string | null>(null);
  const [rootLoaded, setRootLoaded] = useState(false);
  const [files, setFiles] = useState<LocalDocItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<LocalDocSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState<string | null>(null);
  const [activeRawContent, setActiveRawContent] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ relPath: string; markdown: string; duplicate: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  // Bumped only when a file is opened — NOT on rename, which changes
  // activePath but must keep the editor (and its unsaved state) mounted.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    db.getSetting(LOCAL_DOCS_ROOT_KEY).then((v) => {
      if (v) setRoot(v);
      setRootLoaded(true);
    });
  }, []);

  const refresh = useCallback(async (r = root) => {
    if (!r) return;
    try {
      setFiles(await listLocalDocs(r));
    } catch (e) {
      toast.error(String(e));
      setFiles([]);
    }
  }, [root]);

  useEffect(() => { if (root) refresh(root); }, [root]);

  useEffect(() => {
    if (!zenMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZenMode(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode]);

  useEffect(() => () => {
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
  }, []);

  useEffect(() => {
    const query = search.trim();
    const sequence = ++searchSequence.current;
    if (!root || !query) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchLocalDocs(root, query);
        if (sequence === searchSequence.current) setSearchResults(results);
      } catch (error) {
        if (sequence === searchSequence.current) toast.error(String(error));
      } finally {
        if (sequence === searchSequence.current) setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [root, search]);

  const handleMount = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    setActivePath(null);
    setActiveContent(null);
    setActiveRawContent(null);
    setRoot(picked);
    await db.setSetting(LOCAL_DOCS_ROOT_KEY, picked);
  };

  const handleOpen = async (relPath: string) => {
    if (!root) return;
    try {
      const content = await readLocalDoc(root, relPath);
      setActivePath(relPath);
      setActiveContent(mdToDisplay(content, root, relPath));
      setActiveRawContent(content);
      setSaveStatus("idle");
      setEditorKey((k) => k + 1);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleNewFile = async (directory = "") => {
    if (!root) return;
    try {
      const relPath = await createLocalDoc(root, t("doc.untitled"), directory);
      await refresh();
      await handleOpen(relPath);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleMoveFile = async (relPath: string, targetDir: string) => {
    if (!root) return;
    try {
      const newRelPath = await moveLocalDoc(root, relPath, targetDir);
      if (newRelPath === relPath) return;
      if (activePath === relPath) setActivePath(newRelPath);
      await refresh();
      toast.success(t("doc.fileMoved"));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleImportFiles = async () => {
    if (!root) return;
    const picked = await openDialog({ multiple: true, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
    const sources = typeof picked === "string" ? [picked] : picked;
    if (!sources?.length) return;
    try {
      const importedPaths = await importLocalDocs(root, sources);
      await refresh();
      if (importedPaths[0]) await handleOpen(importedPaths[0]);
      toast.success(t("doc.importedCount", { n: importedPaths.length }));
    } catch (error) { toast.error(String(error)); }
  };

  const handleExportFiles = async (relPaths: string[]) => {
    if (!root || relPaths.length === 0) return;
    const destination = await openDialog({ directory: true, multiple: false });
    if (typeof destination !== "string") return;
    try {
      const count = await exportLocalDocs(root, relPaths, destination);
      toast.success(t("doc.exportedCount", { n: count }));
    } catch (error) { toast.error(String(error)); }
  };

  const handleSave = useCallback(async (markdown: string) => {
    if (!root || !activePath) return;
    setSaveStatus("saving");
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    try {
      await writeLocalDoc(root, activePath, markdown);
      setActiveRawContent(markdown);
      setSaveStatus("saved");
      saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 1800);
      refresh();
    } catch (e) {
      setSaveStatus("idle");
      toast.error(String(e));
    }
  }, [root, activePath, refresh]);

  const requestImportToDatabase = useCallback(async (relPath: string, markdown?: string) => {
    if (!root) return;
    try {
      const source = markdown ?? await readLocalDoc(root, relPath);
      const title = relPath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || t("doc.untitled");
      const duplicate = await invoke<boolean>("db_document_title_exists", { title });
      setPendingImport({ relPath, markdown: source, duplicate });
    } catch (error) {
      toast.error(String(error));
    }
  }, [root, t]);

  const confirmImportToDatabase = useCallback(async () => {
    if (!pendingImport) return;
    const { relPath, markdown } = pendingImport;
    const title = relPath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || t("doc.untitled");
    try {
      const blocks = liftMermaid(await markdownToBlocks(markdown));
      const { content, contentText, wordCount } = blocksToStorage(blocks);
      const id = await db.createDocument();
      const created = await db.getDocument(id);
      await db.updateDocument(id, title, content, contentText, created?.tags ?? "[]", false, wordCount);
      setPendingImport(null);
      toast.success(t("doc.copiedToDatabase"));
    } catch (error) {
      toast.error(String(error));
    }
  }, [pendingImport, db, t]);

  const handleRename = async (newName: string) => {
    if (!root || !activePath) return;
    try {
      const newRel = await renameLocalDoc(root, activePath, newName);
      setActivePath(newRel);
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const confirmDelete = async () => {
    const relPath = pendingDelete;
    setPendingDelete(null);
    if (!root || !relPath) return;
    try {
      await deleteLocalDoc(root, relPath);
      toast.success(t("doc.delete"));
      if (activePath === relPath) {
        setActivePath(null);
        setActiveContent(null);
        setActiveRawContent(null);
      }
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const activeMeta = files.find((f) => f.rel_path === activePath);

  if (!rootLoaded) return null;

  return (
    <div className={`flex h-full overflow-hidden bg-background ${zenMode ? "fixed inset-0 z-50" : ""}`}>
      {/* Sidebar */}
      {!zenMode && (
      <Collapsible open={sidebarOpen} onOpenChange={setSidebarOpen} asChild>
      <div className={`${sidebarOpen ? "w-80" : "w-11"} h-full shrink-0 border-r border-border bg-sidebar transition-[width] duration-200`}>
        {!sidebarOpen && (
          <div className="flex justify-center pt-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title={t("doc.expandFiles")} aria-label={t("doc.expandFiles")}>
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
          </div>
        )}
        <CollapsibleContent className="h-full">
        <div className="flex flex-col h-full">
        <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" title={t("doc.collapseFiles")} aria-label={t("doc.collapseFiles")}>
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("doc.tabLocal")}</p>
            </div>
            {root && (
              <div className="flex items-center gap-1">
                <Button onClick={() => void handleNewFile()} className="h-6 px-2.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90">+ {t("doc.newFile")}</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void handleNewFile("")}><FileText className="h-3.5 w-3.5" /> {t("doc.newFileHere")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleImportFiles()}><FileInput className="h-3.5 w-3.5" /> {t("doc.importMarkdown")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setExportPickerOpen(true)}><Download className="h-3.5 w-3.5" /> {t("doc.exportAllMarkdown")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {root && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleMount}
                title={root}
                className="w-full h-7 justify-start gap-1.5 px-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate font-mono">{root}</span>
                <span className="ml-auto shrink-0 underline decoration-dotted">{t("doc.changeFolder")}</span>
              </Button>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("doc.searchFilesAndContent")}
                className="w-full h-7 px-2.5 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </>
          )}
        </div>

        {/* File list / empty states */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
          {!root ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-muted-foreground gap-3 px-4">
              <p className="text-sm">{t("doc.noFolderMounted")}</p>
              <p className="text-xs opacity-60">{t("doc.noFolderHint")}</p>
              <Button
                onClick={handleMount}
                className="h-7 px-3 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                {t("doc.mountFolder")}
              </Button>
            </div>
          ) : search.trim() ? (
            searching ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("doc.searching")}
              </div>
            ) : searchResults.length > 0 ? (
              <SearchResults results={searchResults} query={search.trim()} activePath={activePath} onOpen={handleOpen} />
            ) : (
              <div className="py-12 text-center text-xs text-muted-foreground">{t("doc.noSearchResults")}</div>
            )
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-1">
              <p className="text-sm">{t("doc.noLocalFiles")}</p>
              <p className="text-xs opacity-60">{t("doc.noLocalFilesHint")}</p>
            </div>
          ) : (
            <LocalDocTree
              files={files}
              activePath={activePath}
              onOpen={handleOpen}
              onDelete={setPendingDelete}
              onImport={(relPath) => void requestImportToDatabase(relPath)}
              onExport={(relPath) => void handleExportFiles([relPath])}
              onMove={(relPath, targetDir) => void handleMoveFile(relPath, targetDir)}
              onCreateInFolder={(directory) => void handleNewFile(directory)}
            />
          )}
        </div>

        {root && files.length > 0 && (
          <div className="px-3 py-2 border-t border-border shrink-0">
            <span className="text-[10px] text-muted-foreground">{t("doc.total", { n: files.length })}</span>
          </div>
        )}
        </div>
        </CollapsibleContent>
      </div>
      </Collapsible>
      )}

      {/* Editor pane */}
      <div className="flex-1 overflow-hidden">
        {activePath !== null && activeContent !== null && activeRawContent !== null ? (
          <LazyLocalDocEditor
            key={editorKey}
            relPath={activePath}
            initialMarkdown={activeContent}
            initialRawMarkdown={activeRawContent}
            modifiedMs={activeMeta?.modified_ms ?? 0}
            saveStatus={saveStatus}
            onSave={handleSave}
            toRawMarkdown={(markdown) => mdFromDisplay(markdown, root!, activePath)}
            toDisplayMarkdown={(markdown) => mdToDisplay(markdown, root!, activePath)}
            onRename={handleRename}
            zenMode={zenMode}
            onZenModeChange={setZenMode}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-14 h-14 opacity-20">
              <path d="M6 12a3 3 0 013-3h8l4 4h18a3 3 0 013 3v20a3 3 0 01-3 3H9a3 3 0 01-3-3V12z" strokeLinejoin="round" />
              <path d="M18 24h12M18 30h8" strokeLinecap="round" />
            </svg>
            <p className="text-sm">{t("doc.noFileSelected")}</p>
            <p className="text-xs opacity-60">{t("doc.noFileHint")}</p>
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("doc.deleteFileTitle")}
        message={t("doc.deleteFileConfirm")}
        confirmLabel={t("doc.delete")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
      <ConfirmModal
        open={pendingImport !== null}
        title={pendingImport?.duplicate ? t("doc.duplicateDatabaseTitle") : t("doc.copyToDatabaseTitle")}
        message={pendingImport?.duplicate ? t("doc.duplicateDatabaseConfirm") : t("doc.copyToDatabaseConfirm")}
        confirmLabel={pendingImport?.duplicate ? t("doc.copyAnyway") : t("doc.copyToDatabase")}
        danger={false}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => void confirmImportToDatabase()}
      />
      <ExportMarkdownDialog
        open={exportPickerOpen}
        items={files.map((file) => ({ id: file.rel_path, label: file.name.replace(/\.(md|markdown)$/i, ""), detail: file.rel_path }))}
        onClose={() => setExportPickerOpen(false)}
        onExport={(paths) => {
          setExportPickerOpen(false);
          void handleExportFiles(paths);
        }}
      />
    </div>
  );
}
