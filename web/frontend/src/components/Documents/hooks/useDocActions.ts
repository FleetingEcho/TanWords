import { useRef, useState, useCallback } from "react";
import { invoke } from "@/api/client";
import { toast } from "sonner";
import { useDB, DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import type { DocumentPasswordRequest } from "../DocumentPasswordDialog";

type PrivatePasswordStatus = {
  configured: boolean;
  unlocked: boolean;
  legacy_documents: number;
};

/** Let an editor holding this doc open know its metadata changed, so its
 *  next autosave (which rewrites the whole record from its own state)
 *  doesn't revert the change. The list listens to the same event. */
function notifyDocItemUpdated(detail: { id: number; title?: string; tags?: string; pinned?: boolean; wordCount?: number }) {
  window.dispatchEvent(new CustomEvent("docs-item-updated", { detail }));
}

/** Per-document actions: rename/pin/duplicate/delete, and the
 *  privacy/password flow (protect, unlock, remove protection, create a new
 *  private doc). Split out of DocSelector because it's the largest cluster
 *  of handlers and shares no state with the list/filter concerns. */
export function useDocActions(params: {
  db: ReturnType<typeof useDB>;
  activeId: number | null;
  onSelect: (id: number) => void;
  load: (page?: number) => Promise<void>;
  page: number;
  setPrivateOpen: (open: boolean) => void;
}) {
  const { db, activeId, onSelect, load, page, setPrivateOpen } = params;
  const t = useT();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
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

  // useCallback on every action: memoized DocItem rows receive these as
  // props; unstable identities would defeat the memo on every parent render.
  const handleRename = useCallback(async (id: number, title: string) => {
    const doc = await db.getDocument(id);
    if (!doc) return;
    await db.updateDocument(id, title, doc.content, doc.content_text, doc.tags, doc.pinned, doc.word_count);
    notifyDocItemUpdated({ id, title, tags: doc.tags, pinned: doc.pinned });
    load(page);
  }, [db, load, page]);

  const handlePin = useCallback(async (id: number) => {
    const doc = await db.getDocument(id);
    if (!doc) return;
    await db.updateDocument(id, doc.title, doc.content, doc.content_text, doc.tags, !doc.pinned, doc.word_count);
    notifyDocItemUpdated({ id, title: doc.title, tags: doc.tags, pinned: !doc.pinned });
    load(page);
  }, [db, load, page]);

  const handleDuplicate = useCallback(async (id: number) => {
    const newId = await db.duplicateDocument(id);
    load(page);
    onSelect(newId);
  }, [db, load, page, onSelect]);

  const handleDelete = useCallback((id: number) => setPendingDeleteId(id), []);

  const passwordForPrivateDocument = useCallback(async (): Promise<string | undefined | null> => {
    const status = await invoke<PrivatePasswordStatus>("db_private_password_status");
    if (status.configured && status.unlocked) return undefined;
    return requestPassword({
      title: status.configured ? t("doc.unlock") : t("doc.setPrivatePassword"),
      description: status.configured ? t("doc.sharedPasswordPrompt") : t("doc.sharedPasswordSetupHint"),
      confirm: !status.configured,
    });
  }, [requestPassword, t]);

  const handlePrivacyAction = useCallback(async (doc: DocumentListItem) => {
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
  }, [db, onSelect, activeId, load, page, passwordForPrivateDocument, t]);

  const handleRemoveProtection = useCallback(async (doc: DocumentListItem) => {
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
  }, [db, load, page, requestPassword, activeId, onSelect, t]);

  const handleNewPrivateDoc = useCallback(async () => {
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
  }, [db, passwordForPrivateDocument, load, onSelect, setPrivateOpen, t]);

  const confirmDelete = useCallback(async () => {
    const id = pendingDeleteId;
    if (id === null) return;
    setPendingDeleteId(null);
    await db.deleteDocument(id);
    toast.success(t("doc.delete"));
    load(page);
    if (activeId === id) onSelect(-1);
  }, [db, load, page, pendingDeleteId, activeId, onSelect, t]);

  return {
    pendingDeleteId, setPendingDeleteId, confirmDelete,
    passwordRequest, requestPassword, finishPasswordRequest, passwordForPrivateDocument,
    handleRename, handlePin, handleDuplicate, handleDelete,
    handlePrivacyAction, handleRemoveProtection, handleNewPrivateDoc,
  };
}

export type DocActionsState = ReturnType<typeof useDocActions>;
