import { useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useDB, DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import type { DocumentPasswordRequest } from "../DocumentPasswordDialog";

type PrivatePasswordStatus = {
  configured: boolean;
  unlocked: boolean;
  legacy_documents: number;
};

/** Per-document actions: rename/pin/duplicate/delete, and the
 * privacy/password flow (protect, unlock, remove protection, create a new
 * private doc). Split out of DocSelector because it's the largest cluster
 * of handlers and shares no state with the list/filter concerns. */
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

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (id === null) return;
    setPendingDeleteId(null);
    await db.deleteDocument(id);
    toast.success(t("doc.delete"));
    load(page);
    if (activeId === id) onSelect(-1);
  };

  return {
    pendingDeleteId, setPendingDeleteId, confirmDelete,
    passwordRequest, requestPassword, finishPasswordRequest, passwordForPrivateDocument,
    handleRename, handlePin, handleDuplicate, handleDelete,
    handlePrivacyAction, handleRemoveProtection, handleNewPrivateDoc,
  };
}

export type DocActionsState = ReturnType<typeof useDocActions>;
