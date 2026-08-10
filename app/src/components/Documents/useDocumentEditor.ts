import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, DocumentDetail, DocStatus } from "@/hooks/useDB";
import { pruneDocumentAssets } from "@/lib/documentAssets";
import { saveDocumentRevision } from "@/lib/documentRevisions";
import { countTaskBlocks } from "./taskCounts";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved";

/** Shared document CRUD + autosave logic behind DocEditor, used by both the
 *  full Documents page and the quick-access SaveDocDrawer. */
export function useDocumentEditor() {
  const db = useDB();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [refreshKey, setRefreshKey] = useState(0);
  /** True while a doc's content is being fetched — a large document can take a
   *  second or two, and without this the page just goes blank in between. */
  const [loading, setLoading] = useState(false);
  const [lockedId, setLockedId] = useState<number | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const loadSequence = useRef(0);
  const lastSavedContent = useRef<string | null>(null);

  const pendingSave = useRef<{ content: string; contentText: string; wordCount: number } | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const savedStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);
  }, []);

  const loadDoc = useCallback(async (id: number) => {
    const sequence = ++loadSequence.current;
    if (id < 0) {
      setActiveId(null);
      activeIdRef.current = null;
      setDoc(null);
      setLockedId(null);
      setLoading(false);
      return;
    }

    // Selection is urgent UI state: unmount the previous Tiptap before any
    // IPC/parse work. Keeping a huge editor alive until the next fetch returns
    // lets its synchronous DOM mount swallow every subsequent click.
    setActiveId(id);
    activeIdRef.current = id;
    setDoc(null);
    setLockedId(null);
    setSaveStatus("idle");
    setLoading(true);
    try {
      const detail = await db.getDocument(id);
      if (sequence !== loadSequence.current) return;
      if (detail) {
        setDoc(detail);
        lastSavedContent.current = detail.content;
      }
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      if (String(error).includes("DOCUMENT_LOCKED")) {
        setLockedId(id);
      } else {
        throw error;
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [db]);

  const unlockDocument = useCallback(async (password: string) => {
    if (lockedId === null) return;
    await db.unlockDocument(lockedId, password);
    await loadDoc(lockedId);
    setRefreshKey((key) => key + 1);
  }, [db, loadDoc, lockedId]);

  const removeLockedProtection = useCallback(async (password: string) => {
    if (lockedId === null) return;
    await db.removeDocumentProtection(lockedId, password);
    await loadDoc(lockedId);
    setRefreshKey((key) => key + 1);
  }, [db, loadDoc, lockedId]);

  /** Files the new document straight into a library folder — the shelf tree's
   *  "new document here". Kept separate from `handleNewDoc` rather than made an
   *  optional parameter of it: that one is wired to onClick in the panel
   *  header, which would hand it a MouseEvent as the folder. */
  const handleNewDocIn = useCallback(async (folder: string) => {
    const id = await db.createDocument();
    if (folder) await db.setDocumentsFolder([id], folder);
    setRefreshKey((k) => k + 1);
    await loadDoc(id);
  }, [db, loadDoc]);

  const handleNewDoc = useCallback(() => handleNewDocIn(""), [handleNewDocIn]);

  const handleSave = useCallback(async (content: string, contentText: string, wordCount: number) => {
    if (!doc) return;
    const documentId = doc.id;
    const title = doc.title;
    const tags = doc.tags;
    const pinned = doc.pinned;
    const status = doc.status;
    pendingSave.current = { content, contentText, wordCount };
    setSaveStatus("saving");
    const save = async () => {
      try {
        const saved = await db.updateDocument(documentId, title, content, contentText, tags, pinned, wordCount, status);
        if (!saved) throw new Error("Save failed");
        await pruneDocumentAssets(documentId, content);
        if (content !== lastSavedContent.current) {
          saveDocumentRevision(documentId, { title, content, contentText, wordCount });
          lastSavedContent.current = content;
        }
        if (activeIdRef.current === documentId && pendingSave.current?.content === content) {
          setSaveStatus("saved");
          if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);
          savedStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 1800);
        }
        const tasks = countTaskBlocks(content);
        window.dispatchEvent(new CustomEvent("docs-item-updated", {
          detail: {
            id: documentId, wordCount, title, tags, pinned, status,
            // Optimistic checklist counts so the list's task bar moves without
            // a refetch; the DB value Rust writes is the source of truth.
            // Names must match useDocList's listener — the detail is an
            // untyped CustomEvent, so a mismatch fails silently.
            taskTotal: tasks.total, taskDone: tasks.done,
          },
        }));
        setDoc((prev) => (prev?.id === documentId
          ? { ...prev, content, content_text: contentText, word_count: wordCount }
          : prev));
      } catch {
        setSaveStatus("idle");
        toast.error("Save failed");
      }
    };
    saveQueue.current = saveQueue.current.then(save, save);
    await saveQueue.current;
  }, [db, doc]);

  const markDirty = useCallback(() => {
    if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);
    setSaveStatus("dirty");
  }, []);

  // handleSave rewrites the whole record (title/tags/pinned included) from
  // this hook's doc state. The sidebar's rename/pin (useDocActions) goes
  // straight to the DB — without this subscription, the open editor's next
  // autosave would write the old metadata back and silently revert them.
  useEffect(() => {
    const onItemUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ id: number; title?: string; tags?: string; pinned?: boolean; status?: string }>).detail;
      if (!detail || detail.id !== activeIdRef.current) return;
      setDoc((prev) => (prev && prev.id === detail.id
        ? {
            ...prev,
            title: detail.title ?? prev.title,
            tags: detail.tags ?? prev.tags,
            pinned: detail.pinned ?? prev.pinned,
            status: (detail.status ?? prev.status) as DocStatus,
          }
        : prev));
    };
    window.addEventListener("docs-item-updated", onItemUpdated);
    return () => window.removeEventListener("docs-item-updated", onItemUpdated);
  }, []);

  const handleTitleChange = useCallback(async (title: string) => {
    if (!doc) return;
    setDoc((prev) => (prev ? { ...prev, title } : prev));
    await db.updateDocument(doc.id, title, doc.content, doc.content_text, doc.tags, doc.pinned, doc.word_count, doc.status);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  // Bumps refreshKey rather than patching the list in place: a brand-new tag
  // also has to reach the list's `allTags`, which only reloads on that key.
  const handleTagsChange = useCallback(async (tags: string[]) => {
    if (!doc) return;
    const serialized = JSON.stringify(tags);
    setDoc((prev) => (prev ? { ...prev, tags: serialized } : prev));
    await db.updateDocument(doc.id, doc.title, doc.content, doc.content_text, serialized, doc.pinned, doc.word_count, doc.status);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  // The status dropdown writes through the same hook state as every other
  // editor metadata (title/tags/pin): the next autosave would otherwise
  // rewrite the record and revert the change. Bumps refreshKey so the list's
  // status filter and the sidebar counts reload their queries.
  const handleStatusChange = useCallback(async (status: DocStatus) => {
    if (!doc) return;
    setDoc((prev) => (prev ? { ...prev, status } : prev));
    await db.updateDocument(doc.id, doc.title, doc.content, doc.content_text, doc.tags, doc.pinned, doc.word_count, status);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  const handlePinToggle = useCallback(async () => {
    if (!doc) return;
    const newPinned = !doc.pinned;
    setDoc((prev) => (prev ? { ...prev, pinned: newPinned } : prev));
    await db.updateDocument(doc.id, doc.title, doc.content, doc.content_text, doc.tags, newPinned, doc.word_count, doc.status);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  const reset = useCallback(() => {
    setActiveId(null);
    activeIdRef.current = null;
    setDoc(null);
    setLockedId(null);
    setSaveStatus("idle");
  }, []);

  return {
    activeId, doc, lockedId, saveStatus, refreshKey, loading,
    loadDoc, handleNewDoc, handleNewDocIn, handleSave, markDirty, handleTitleChange, handleTagsChange, handleStatusChange, handlePinToggle,
    unlockDocument, removeLockedProtection,
    reset,
  };
}
