import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, DocumentDetail } from "@/hooks/useDB";

export type SaveStatus = "idle" | "saving" | "saved";

/** Shared document CRUD + autosave logic behind DocEditor, used by both the
 *  full Documents page and the quick-access SaveDocDrawer. */
export function useDocumentEditor() {
  const db = useDB();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [refreshKey, setRefreshKey] = useState(0);

  const pendingSave = useRef<{ content: string; contentText: string; wordCount: number } | null>(null);

  const loadDoc = useCallback(async (id: number) => {
    if (id < 0) {
      setActiveId(null);
      setDoc(null);
      return;
    }
    const detail = await db.getDocument(id);
    if (detail) {
      setDoc(detail);
      setActiveId(id);
      setSaveStatus("idle");
    }
  }, [db]);

  const handleNewDoc = useCallback(async () => {
    const id = await db.createDocument();
    setRefreshKey((k) => k + 1);
    await loadDoc(id);
  }, [db, loadDoc]);

  const handleSave = useCallback(async (content: string, contentText: string, wordCount: number) => {
    if (!doc) return;
    pendingSave.current = { content, contentText, wordCount };
    setSaveStatus("saving");
    try {
      await db.updateDocument(doc.id, doc.title, content, contentText, doc.tags, doc.pinned, wordCount);
      setSaveStatus("saved");
      setRefreshKey((k) => k + 1);
      setDoc((prev) => (prev ? { ...prev, content, content_text: contentText, word_count: wordCount } : prev));
    } catch {
      setSaveStatus("idle");
      toast.error("Save failed");
    }
  }, [db, doc]);

  const handleTitleChange = useCallback(async (title: string) => {
    if (!doc) return;
    setDoc((prev) => (prev ? { ...prev, title } : prev));
    await db.updateDocument(doc.id, title, doc.content, doc.content_text, doc.tags, doc.pinned, doc.word_count);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  const handleTagsChange = useCallback(async (tags: string) => {
    if (!doc) return;
    setDoc((prev) => (prev ? { ...prev, tags } : prev));
    await db.updateDocument(doc.id, doc.title, doc.content, doc.content_text, tags, doc.pinned, doc.word_count);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  const handlePinToggle = useCallback(async () => {
    if (!doc) return;
    const newPinned = !doc.pinned;
    setDoc((prev) => (prev ? { ...prev, pinned: newPinned } : prev));
    await db.updateDocument(doc.id, doc.title, doc.content, doc.content_text, doc.tags, newPinned, doc.word_count);
    setRefreshKey((k) => k + 1);
  }, [db, doc]);

  const reset = useCallback(() => {
    setActiveId(null);
    setDoc(null);
    setSaveStatus("idle");
  }, []);

  return {
    activeId, doc, saveStatus, refreshKey,
    loadDoc, handleNewDoc, handleSave, handleTitleChange, handleTagsChange, handlePinToggle,
    reset,
  };
}
