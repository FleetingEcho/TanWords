import { useCallback, useEffect, useRef, useState } from "react";
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
import { SaveStatus } from "./useDocumentEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { blocksToStorage, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid } from "./mermaidTransforms";
import { ExportMarkdownDialog } from "./ExportMarkdownDialog";
import { LocalDocsSidebar } from "./LocalDocsSidebar";
import { LocalDocsEditorPane } from "./LocalDocsEditorPane";

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
        <LocalDocsSidebar
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          root={root}
          onMount={handleMount}
          onNewFile={(directory) => void handleNewFile(directory)}
          onImportFiles={() => void handleImportFiles()}
          onOpenExportPicker={() => setExportPickerOpen(true)}
          search={search}
          onSearchChange={setSearch}
          searching={searching}
          searchResults={searchResults}
          files={files}
          activePath={activePath}
          onOpen={handleOpen}
          onDelete={setPendingDelete}
          onImport={(relPath) => void requestImportToDatabase(relPath)}
          onExport={(relPath) => void handleExportFiles([relPath])}
          onMove={(relPath, targetDir) => void handleMoveFile(relPath, targetDir)}
        />
      )}

      {/* Editor pane */}
      <LocalDocsEditorPane
        editorKey={editorKey}
        activePath={activePath}
        activeContent={activeContent}
        activeRawContent={activeRawContent}
        modifiedMs={activeMeta?.modified_ms ?? 0}
        saveStatus={saveStatus}
        onSave={handleSave}
        toRawMarkdown={(markdown) => mdFromDisplay(markdown, root!, activePath!)}
        toDisplayMarkdown={(markdown) => mdToDisplay(markdown, root!, activePath!)}
        onRename={handleRename}
        zenMode={zenMode}
        onZenModeChange={setZenMode}
      />

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
