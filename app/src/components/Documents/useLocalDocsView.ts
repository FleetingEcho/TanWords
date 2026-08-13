import { useCallback, useEffect, useRef, useState } from "react";
import { openDialog } from "@/ipc/dialog";
import { toast } from "sonner";
import { invoke } from "@/ipc/backend";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import {
  LOCAL_DOCS_ROOT_KEY, LocalDocItem, LocalDocSearchResult,
  createLocalDoc, deleteLocalDoc, listLocalDocs, mdFromDisplay, mdToDisplay,
  moveLocalDoc, createLocalDocFolder, renameLocalDocFolder, deleteLocalDocFolder,
  readLocalDoc, renameLocalDoc, searchLocalDocs, writeLocalDoc,
  importLocalDocs, exportLocalDocs, uploadLocalDocImage,
} from "@/lib/localDocs";
import { SaveStatus } from "./useDocumentEditor";
import { useSettingsStore } from "@/store/settingsStore";
import { useLayoutStore } from "@/store/layoutStore";
import { blocksToStorage, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid } from "./mermaidTransforms";
import { liftMedia, liftYouTube } from "./mediaTransforms";
import { exportMarkdownAsHtml, exportMarkdownAsPdf } from "@/lib/documentExport";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";
import type { FolderNameRequest } from "./FolderNameDialog";
import { localDocRowOrder } from "./LocalDocTree";
import { commonBase, targetFolder } from "./importPaths";

const LAST_LOCAL_PATH_KEY = "tanwords_doc_last_local_path";

export function useLocalDocsView(refreshTick: number, onRefreshingChange?: (refreshing: boolean) => void) {
  const db = useDB();
  const t = useT();
  const hasCustomAppBackground = useSettingsStore((s) => !!s.appBackgroundImage && s.appBackgroundVisible);
  const setZenModeGlobal = useLayoutStore((s) => s.setZenMode);

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
  const openSequence = useRef(0);
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
  /** Files chosen for import, waiting on a destination folder. `base` is the
   *  path prefix stripped from each before rebuilding the structure. */
  const [pendingImport, setPendingImport] = useState<{ relPaths: string[]; base: string } | null>(null);
  /** The destination is settled and some titles already exist in the library. */
  const [pendingDuplicates, setPendingDuplicates] = useState<{ relPaths: string[]; base: string; folder: string; duplicates: number } | null>(null);
  const [importing, setImporting] = useState(false);
  /** Ticked files, for the batch import. Paths, not indices — the list is
   *  rebuilt from disk on every refresh and indices would drift. */
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  /** Where a shift-click measures its range from. */
  const selectionAnchor = useRef<string | null>(null);
  /** Multi-select is a mode, entered by double-clicking a row. Rows carry no
   *  checkbox outside it — a permanently visible tick box on every file is
   *  clutter for the reading-and-editing this list is mostly used for. */
  const [selectionMode, setSelectionMode] = useState(false);
  /** The "+" asks where the file goes rather than always dropping it at the
   *  vault root — filing it afterwards was a second step, usually forgotten. */
  const [newFileFolderOpen, setNewFileFolderOpen] = useState(false);
  /** Directories currently in the vault, derived from the files' own paths. */
  const [vaultDirs, setVaultDirs] = useState<string[]>([]);
  const [folderPrompt, setFolderPrompt] = useState<FolderNameRequest | null>(null);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpenState] = useState(() => localStorage.getItem("tanwords_doc_local_sidebar_collapsed") !== "1");
  const [showMobileEditor, setShowMobileEditor] = useState(false);
  const isNarrow = useIsNarrow();
  const setSidebarOpen = (open: boolean) => {
    localStorage.setItem("tanwords_doc_local_sidebar_collapsed", open ? "0" : "1");
    setSidebarOpenState(open);
  };
  useEffect(() => {
    if (isNarrow) setSidebarOpenState(true);
  }, [isNarrow]);
  const [zenMode, setZenMode] = useState(false);
  // Let AppBackground lift its layer above the app chrome while zen is open.
  useEffect(() => {
    setZenModeGlobal(zenMode);
    return () => setZenModeGlobal(false);
  }, [zenMode, setZenModeGlobal]);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  // Bumped only when a file is opened — NOT on rename, which changes
  // activePath but must keep the editor (and its unsaved state) mounted.
  const [editorKey, setEditorKey] = useState(0);
  // True once the initial auto-reopen (below) has been attempted, so mounting a *new*
  // folder later via handleMount doesn't retrigger it with the stale previous path.
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    db.getDevicePath(LOCAL_DOCS_ROOT_KEY).then((v) => {
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
    if (refreshTick === 0) return;
    void refresh();
  }, [refreshTick, refresh]);

  useEffect(() => {
    onRefreshingChange?.(filesLoading);
  }, [filesLoading, onRefreshingChange]);

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
    setShowMobileEditor(false);
    await db.setDevicePath(LOCAL_DOCS_ROOT_KEY, picked);
  };

  const handleOpen = async (relPath: string, opts?: { silent?: boolean }) => {
    if (!root) return;
    const sequence = ++openSequence.current;
    // Switch selection and tear down the previous editor before filesystem I/O.
    // Only the latest read may populate the pane; slow earlier files cannot
    // jump back in front after the user has already selected something else.
    setActivePath(relPath);
    activePathRef.current = relPath;
    setActiveContent(null);
    setActiveRawContent(null);
    setShowMobileEditor(true);
    setSaveStatus("idle");
    setEditorKey((key) => key + 1);
    setFileLoading(true);
    try {
      const content = await readLocalDoc(root, relPath);
      if (sequence !== openSequence.current) return;
      setActiveContent(mdToDisplay(content, root, relPath));
      setActiveRawContent(content);
    } catch (e) {
      // Auto-reopen on mount fails silently if the file moved/was deleted since
      // last session — not worth greeting the user with an error toast on launch.
      if (sequence === openSequence.current && !opts?.silent) toast.error(String(e));
    } finally {
      if (sequence === openSequence.current) setFileLoading(false);
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

  /** Double-click: in, selecting that row; or out, dropping the selection. */
  const toggleSelectionMode = useCallback((relPath: string) => {
    setSelectionMode((on) => {
      if (on) {
        setSelectedPaths(new Set());
        selectionAnchor.current = null;
        return false;
      }
      setSelectedPaths(new Set([relPath]));
      selectionAnchor.current = relPath;
      return true;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPaths(new Set());
    selectionAnchor.current = null;
  }, []);

  const toggleSelect = useCallback((relPath: string, range: boolean) => {
    // A modifier-click is itself a request to start selecting.
    setSelectionMode(true);
    setSelectedPaths((current) => {
      const next = new Set(current);
      const anchor = selectionAnchor.current;
      if (range && anchor && anchor !== relPath) {
        const order = localDocRowOrder(files);
        const from = order.indexOf(anchor);
        const to = order.indexOf(relPath);
        if (from >= 0 && to >= 0) {
          for (const path of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(path);
          return next;
        }
      }
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
    selectionAnchor.current = relPath;
  }, [files]);

  const selectFolderFiles = useCallback((relPaths: string[], select: boolean) => {
    if (select) setSelectionMode(true);
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const path of relPaths) {
        if (select) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const dirs = new Set<string>();
    for (const file of files) {
      const segments = file.rel_path.split("/").slice(0, -1);
      for (let i = 0; i < segments.length; i++) dirs.add(segments.slice(0, i + 1).join("/"));
    }
    // Union rather than replace: a folder just created through the picker holds
    // no files yet, so listing alone would make it vanish before it is used.
    setVaultDirs((current) => [...new Set([...current, ...dirs])].sort((a, b) => a.localeCompare(b)));
  }, [files]);

  // A file that was renamed, moved, or deleted elsewhere must not linger in the
  // selection as a path that no longer resolves.
  useEffect(() => {
    setSelectedPaths((current) => {
      if (current.size === 0) return current;
      const live = new Set(files.map((f) => f.rel_path));
      const next = new Set([...current].filter((path) => live.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [files]);

  // Folder operations, mirroring the library's folder menu. The vault is a real
  // directory tree, so these are filesystem calls rather than row updates.
  const promptCreateFolder = (parent: string) => setFolderPrompt({
    title: t("doc.newFolder"),
    hint: parent ? t("doc.newFolderIn", { path: parent }) : t("doc.newFolderAtRoot"),
    confirmLabel: t("doc.createFolder"),
    onSubmit: (name) => {
      if (!root) return;
      void createLocalDocFolder(root, parent ? `${parent}/${name}` : name)
        .then((created) => {
          setVaultDirs((current) => [...new Set([...current, created])].sort((a, b) => a.localeCompare(b)));
        })
        .catch((error) => toast.error(String(error)));
    },
  });

  const promptRenameFolder = (path: string) => setFolderPrompt({
    title: t("doc.renameFolder"),
    initialValue: path.slice(path.lastIndexOf("/") + 1),
    confirmLabel: t("doc.rename"),
    onSubmit: (name) => {
      if (!root) return;
      void renameLocalDocFolder(root, path, name)
        .then(() => refresh())
        .catch((error) => toast.error(String(error)));
    },
  });

  const confirmDeleteFolder = async () => {
    const path = pendingFolderDelete;
    setPendingFolderDelete(null);
    if (!root || !path) return;
    try {
      await deleteLocalDocFolder(root, path);
      // The open file may have been inside it.
      if (activePath?.startsWith(`${path}/`)) {
        setActivePath(null);
        setActiveContent(null);
        setActiveRawContent(null);
        setShowMobileEditor(false);
      }
      setVaultDirs((current) => current.filter((dir) => dir !== path && !dir.startsWith(`${path}/`)));
      await refresh();
      toast.success(t("doc.folderDeleted"));
    } catch (error) {
      toast.error(String(error));
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

  const handleExportHtml = async (relPath: string) => {
    if (!root) return;
    try {
      const content = await readLocalDoc(root, relPath);
      const title = relPath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || t("doc.untitled");
      await exportMarkdownAsHtml(title, mdToDisplay(content, root, relPath));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleExportPdf = async (relPath: string) => {
    if (!root) return;
    try {
      const content = await readLocalDoc(root, relPath);
      const title = relPath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || t("doc.untitled");
      await exportMarkdownAsPdf(title, mdToDisplay(content, root, relPath));
    } catch (error) {
      toast.error(String(error));
    }
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

  // ── Import into the library ───────────────────────────────────────────────
  // One path for one file and for a hundred: pick the destination folder, warn
  // once about any title collisions, then convert and insert. The single-file
  // menu item used to import straight to the library root, which became the
  // odd one out the moment the library grew folders of its own.

  const requestImportToLibrary = useCallback((relPaths: string[], base?: string) => {
    if (!root || relPaths.length === 0) return;
    setPendingImport({ relPaths, base: base ?? commonBase(relPaths) });
  }, [root]);

  /** Recreates a whole local folder under the chosen library folder: the base
   *  is the folder's *parent*, so the folder's own name survives the trip. */
  const requestImportFolder = useCallback((directory: string) => {
    const paths = files.filter((f) => f.rel_path.startsWith(`${directory}/`)).map((f) => f.rel_path);
    if (paths.length === 0) {
      toast.error(t("doc.folderHasNoFiles"));
      return;
    }
    const parent = directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";
    requestImportToLibrary(paths, parent);
  }, [files, requestImportToLibrary, t]);

  const runImport = useCallback(async (relPaths: string[], base: string, destination: string) => {
    if (!root) return;
    setImporting(true);
    let imported = 0;
    const failures: string[] = [];
    try {
      for (const relPath of relPaths) {
        try {
          const markdown = await readLocalDoc(root, relPath);
          const title = relPath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || t("doc.untitled");
          const blocks = liftYouTube(liftMedia(liftMermaid(await markdownToBlocks(markdown))));
          const { content, contentText, wordCount } = blocksToStorage(blocks);
          const folder = targetFolder(relPath, base, destination);
          await db.createDocumentWithContent(title, content, contentText, "[]", wordCount, folder);
          imported++;
        } catch (error) {
          failures.push(`${relPath}: ${String(error)}`);
        }
      }
    } finally {
      setImporting(false);
    }
    setSelectedPaths(new Set());
    setSelectionMode(false);
    // The library list is a sibling tab holding its own state; this is the
    // event it already reloads on (see useDocList).
    window.dispatchEvent(new Event("docs-updated"));
    if (imported > 0) toast.success(t("doc.importedToLibraryCount", { n: imported }));
    // Reported as one message: a vault full of unreadable files would otherwise
    // bury the success toast under a stack of identical errors.
    if (failures.length > 0) toast.error(t("doc.importFailedCount", { n: failures.length }));
  }, [root, db, t]);

  const confirmImportToLibrary = useCallback(async (destination: string) => {
    if (!pendingImport) return;
    const { relPaths, base } = pendingImport;
    setPendingImport(null);
    const titles = relPaths.map((p) => p.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || t("doc.untitled"));
    let duplicates = 0;
    try {
      const existing = await Promise.all(
        titles.map((title) => invoke<boolean>("db_document_title_exists", { title })),
      );
      duplicates = existing.filter(Boolean).length;
    } catch {
      // A failed duplicate probe is not a reason to block the import; the
      // worst case is a second document with the same title.
    }
    if (duplicates > 0) {
      setPendingDuplicates({ relPaths, base, folder: destination, duplicates });
      return;
    }
    await runImport(relPaths, base, destination);
  }, [pendingImport, runImport, t]);

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
        setShowMobileEditor(false);
      }
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const activeMeta = files.find((f) => f.rel_path === activePath);

  return { root, rootLoaded, files, filesLoading, search, searchResults, searching, activePath, activeContent, activeRawContent, fileLoading, saveStatus, pendingDelete, pendingImport, pendingDuplicates, importing, selectedPaths, selectionMode, newFileFolderOpen, vaultDirs, folderPrompt, pendingFolderDelete, sidebarOpen, showMobileEditor, zenMode, exportPickerOpen, editorKey, t, hasCustomAppBackground, isNarrow, activeMeta, setRoot, setRootLoaded, setFiles, setFilesLoading, setSearch, setSearchResults, setSearching, setActivePath, setActiveContent, setActiveRawContent, setFileLoading, setSaveStatus, setPendingDelete, setPendingImport, setPendingDuplicates, setImporting, setSelectedPaths, setSelectionMode, setNewFileFolderOpen, setVaultDirs, setFolderPrompt, setPendingFolderDelete, setSidebarOpenState, setShowMobileEditor, setZenMode, setExportPickerOpen, setEditorKey, setSidebarOpen, handleMount, handleOpen, handleNewFile, toggleSelectionMode, exitSelectionMode, toggleSelect, selectFolderFiles, promptCreateFolder, promptRenameFolder, confirmDeleteFolder, handleMoveFile, handleImportFiles, handleExportFiles, handleExportHtml, handleExportPdf, handleSave, markDirty, handleUploadImage, toRawMarkdown, toDisplayMarkdown, requestImportToLibrary, requestImportFolder, runImport, confirmImportToLibrary, handleRename, confirmDelete };
}
