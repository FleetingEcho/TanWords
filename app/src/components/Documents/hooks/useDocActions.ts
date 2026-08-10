import { useRef, useState, useCallback } from "react";
import { invoke } from "@/ipc/backend";
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
function notifyDocItemUpdated(detail: { id: number; title?: string; tags?: string; pinned?: boolean; wordCount?: number; status?: string }) {
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
  beforeLock?: (id: number) => Promise<void>;
}) {
  const { db, activeId, onSelect, load, page, beforeLock } = params;
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
    const saved = await db.updateDocumentMetadata(id, { title });
    if (saved) notifyDocItemUpdated({ id, title });
  }, [db]);

  const handlePin = useCallback(async (id: number, pinned: boolean) => {
    const saved = await db.updateDocumentMetadata(id, { pinned });
    if (!saved) return;
    notifyDocItemUpdated({ id, pinned });
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
        if (activeId === doc.id) await beforeLock?.(doc.id);
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
  }, [db, onSelect, activeId, load, page, passwordForPrivateDocument, beforeLock]);

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

  // ── Folders ───────────────────────────────────────────────────────────────
  // The tree these drive is derived from `doc.folder` plus the folder list, so
  // every one of them ends with a `load` — there is no in-place patch that
  // would keep the tree honest after a move.

  const handleMoveToFolder = useCallback(async (ids: number[], folder: string) => {
    if (ids.length === 0) return;
    try {
      await db.setDocumentsFolder(ids, folder);
      await load(page);
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, load, page]);

  const handleCreateFolder = useCallback(async (path: string) => {
    try {
      await db.createDocumentFolder(path);
      await load(page);
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, load, page]);

  const handleRenameFolder = useCallback(async (path: string, newPath: string) => {
    try {
      await db.renameDocumentFolder(path, newPath);
      await load(page);
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, load, page]);

  const handleDeleteFolder = useCallback(async (path: string) => {
    try {
      await db.deleteDocumentFolder(path);
      await load(page);
      toast.success(t("doc.folderRemoved"));
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, load, page, t]);

  /** Locks or unlocks a folder, and everything filed under it.
   *
   * Locking only needs a password when the vault has never been set up (or the
   * session is sealed); unlocking always does, because it has to decrypt. */
  const handleSetFolderLocked = useCallback(async (path: string, locked: boolean) => {
    const password = locked
      ? await passwordForPrivateDocument()
      : await requestPassword({ title: t("doc.unlockFolder"), description: t("doc.passwordPrompt") });
    if (password === null) return;
    try {
      await db.setFolderLocked(path, locked, password ?? undefined);
      await load(page);
      toast.success(locked ? t("doc.folderLocked") : t("doc.folderUnlocked"));
    } catch (error) {
      toast.error(String(error) === "INVALID_DOCUMENT_PASSWORD" ? t("doc.invalidPassword") : String(error));
    }
  }, [db, load, page, passwordForPrivateDocument, requestPassword, t]);

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
    handlePrivacyAction, handleRemoveProtection,
    handleMoveToFolder, handleCreateFolder, handleRenameFolder, handleDeleteFolder,
    handleSetFolderLocked,
  };
}

export type DocActionsState = ReturnType<typeof useDocActions>;
