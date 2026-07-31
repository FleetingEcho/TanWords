import { useCallback, useEffect, useRef, useState } from "react";
import { openDialog } from "@/ipc/dialog";
import { toast } from "sonner";
import { invoke } from "@/ipc/backend";

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
  uploadLocalDocImage,
} from "@/lib/localDocs";
import { SaveStatus } from "./useDocumentEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { blocksToStorage, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid } from "./mermaidTransforms";
import { ExportMarkdownDialog } from "./ExportMarkdownDialog";
import { LocalDocsSidebar } from "./LocalDocsSidebar";
import { LocalDocsEditorPane } from "./LocalDocsEditorPane";

const LAST_LOCAL_PATH_KEY = "tanwords_doc_last_local_path";

/** The "local folder" source of the Documents page: mount a folder, then
 *  list/edit/create/delete the markdown files inside it. */
export function LocalDocsView() {
  const db = useDB();
  const t = useT();

  const [root, setRoot] = useState<string | null>(null);
  const [rootLoaded, setRootLoaded] = useState(false);
  const [files, setFiles] = useState<LocalDocItem[]>([]);
  /** A folder with 1000+ files can take a moment to list — without this, the sidebar
   *  shows "no files here" (files.length === 0) while it's still loading, not actually empty. */
  const [filesLoading, setFilesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<LocalDocSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);
  const [activePath, setActivePath] = useState<string | null>(null);
  const activePathRef = useRef<string | null>(null);
  const [activeContent, setActiveContent] = useState<string | null>(null);
  const [activeRawContent, setActiveRawContent] = useState<string | null>(null);
  /** True while a file's content is being read — a large file can take a moment,
   *  same reasoning as the database tab's `loading` in useDocumentEditor. */
  const [fileLoading, setFileLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ relPath: string; markdown: string; duplicate: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpenState] = useState(() => localStorage.getItem("tanwords_doc_local_sidebar_collapsed") !== "1");
  const setSidebarOpen = (open: boolean) => {
    localStorage.setItem("tanwords_doc_local_sidebar_collapsed", open ? "0" : "1");
    setSidebarOpenState(open);
  };
  const [zenMode, setZenMode] = useState(false);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  // Bumped only when a file is opened — NOT on rename, which changes
  // activePath but must keep the editor (and its unsaved state) mounted.
  const [editorKey, setEditorKey] = useState(0);
  // True once the initial auto-reopen (below) has been attempted, so mounting a *new*
  // folder later via handleMount doesn't retrigger it with the stale previous path.
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    db.getSetting(LOCAL_DOCS_ROOT_KEY).then((v) => {
      if (v) setRoot(v);
      setRootLoaded(true);
    });
  }, []);

  // Reopen whichever local file was open last session, once the mounted folder is known.
  useEffect(() => {
    if (!root || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    const lastPath = localStorage.getItem(LAST_LOCAL_PATH_KEY);
    if (lastPath) handleOpen(lastPath, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleOpen is a fresh closure every render; only root gates this one-shot restore.
  }, [root]);

  useEffect(() => {
    activePathRef.current = activePath;
    if (activePath) localStorage.setItem(LAST_LOCAL_PATH_KEY, activePath);
  }, [activePath]);

  const refresh = useCallback(async (r = root) => {
    if (!r) return;
    setFilesLoading(true);
    try {
      setFiles(await listLocalDocs(r));
    } catch (e) {
      toast.error(String(e));
      setFiles([]);
    } finally {
      setFilesLoading(false);
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

  const handleOpen = async (relPath: string, opts?: { silent?: boolean }) => {
    if (!root) return;
    setFileLoading(true);
    try {
      const content = await readLocalDoc(root, relPath);
      setActivePath(relPath);
      setActiveContent(mdToDisplay(content, root, relPath));
      setActiveRawContent(content);
      setSaveStatus("idle");
      setEditorKey((k) => k + 1);
    } catch (e) {
      // Auto-reopen on mount fails silently if the file moved/was deleted since
      // last session — not worth greeting the user with an error toast on launch.
      if (!opts?.silent) toast.error(String(e));
    } finally {
      setFileLoading(false);
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
    const saveRoot = root;
    const savePath = activePath;
    setSaveStatus("saving");
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    const save = async () => {
      try {
        await writeLocalDoc(saveRoot, savePath, markdown);
        setActiveRawContent((current) => activePathRef.current === savePath ? markdown : current);
        if (activePathRef.current === savePath) {
          setSaveStatus("saved");
          saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 1800);
        }
        await refresh();
      } catch (e) {
        setSaveStatus("idle");
        toast.error(String(e));
      }
    };
    saveQueue.current = saveQueue.current.then(save, save);
    await saveQueue.current;
  }, [root, activePath, refresh]);

  const markDirty = useCallback(() => setSaveStatus("dirty"), []);
  const handleUploadImage = useCallback(
    (file: File) => uploadLocalDocImage(root!, file),
    [root],
  );
  const toRawMarkdown = useCallback(
    (markdown: string) => mdFromDisplay(markdown, root!, activePath!),
    [root, activePath],
  );
  const toDisplayMarkdown = useCallback(
    (markdown: string) => mdToDisplay(markdown, root!, activePath!),
    [root, activePath],
  );

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

  const handleRename = useCallback(async (newName: string) => {
    if (!root || !activePath) return;
    try {
      const newRel = await renameLocalDoc(root, activePath, newName);
      setActivePath(newRel);
      void refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }, [root, activePath, refresh]);

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
    <div className={`flex h-full overflow-hidden ${
      zenMode
        ? "fixed inset-0 z-50 bg-background"
        : "bg-transparent"
    }`}>
      {/* Sidebar */}
      {!zenMode && (
        <LocalDocsSidebar
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          root={root}
          onMount={handleMount}
          onRefresh={() => void refresh()}
          onNewFile={(directory) => void handleNewFile(directory)}
          onImportFiles={() => void handleImportFiles()}
          onOpenExportPicker={() => setExportPickerOpen(true)}
          search={search}
          onSearchChange={setSearch}
          searching={searching}
          searchResults={searchResults}
          files={files}
          filesLoading={filesLoading}
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
        loading={fileLoading}
        activePath={activePath}
        activeContent={activeContent}
        activeRawContent={activeRawContent}
        modifiedMs={activeMeta?.modified_ms ?? 0}
        saveStatus={saveStatus}
        onSave={handleSave}
        onDirty={markDirty}
        onUploadImage={handleUploadImage}
        toRawMarkdown={toRawMarkdown}
        toDisplayMarkdown={toDisplayMarkdown}
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
