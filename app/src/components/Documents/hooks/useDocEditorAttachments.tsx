import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { DocumentDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { uploadDocumentAsset } from "@/lib/documentAssets";
import { DocumentPasswordRequest } from "../DocumentPasswordDialog";
import { requiresAttachmentPassword, type PrivateAttachmentAction } from "../privateDocumentPolicy";
import type { DocEditorApi } from "../tiptap/DocEditorApi";
import { TiptapToolbarExtras } from "../tiptap/ui/ToolbarExtras";
import type { Editor } from "@tiptap/core";

/** Attachments (uploading a file into the document, previewing/deleting one
 * through the formatting toolbar) and the password gate a protected
 * document puts in front of downloading or deleting a private file. */
export function useDocEditorAttachments(params: {
  doc: DocumentDetail;
  editor: DocEditorApi | null;
  scheduleSave: () => void;
}) {
  const { doc, editor, scheduleSave } = params;
  const t = useT();
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

  /** Stores a file and hands back its URL, without touching the rich editor.
   *  Raw Markdown mode writes its own link and needs only this half. */
  const uploadFile = useCallback((file: File) => uploadDocumentAsset(doc.id, file), [doc.id]);

  const insertAttachment = async (file: File | undefined) => {
    if (!file || !editor) return;
    try {
      const url = await uploadDocumentAsset(doc.id, file);
      const type = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("audio/") ? "audio"
        : file.type.startsWith("video/") ? "video"
        : "file";
      const current = editor.getTextCursorPosition().block;
      editor.insertBlocks([{
        type,
        props: { url, name: file.name || "attachment" },
      } as any], current, "after");
      scheduleSave();
    } catch (error) {
      toast.error(String(error));
    }
  };

  const sensitiveAttachmentAction = useCallback(async (
    action: PrivateAttachmentAction,
    block: any,
  ) => {
    if (requiresAttachmentPassword(doc.protected, action)) {
      const password = await requestPassword({
        title: action === "download" ? t("doc.downloadPrivateFile") : t("doc.deletePrivateFile"),
        description: t("doc.sensitiveActionPasswordHint"),
      });
      if (!password) return;
      try {
        await invoke("db_unlock_document", { id: doc.id, password });
      } catch {
        toast.error(t("doc.invalidPassword"));
        return;
      }
    }
    if (!editor) return;
    if (action === "delete") {
      editor.focus();
      editor.removeBlocks([block.id]);
      scheduleSave();
      return;
    }
    const downloadUrl = editor.resolveFileUrl
      ? await editor.resolveFileUrl(block.props.url)
      : block.props.url;
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  }, [doc.id, doc.protected, editor, requestPassword, t]);

  /**
   * Extra bubble-toolbar items.
   *
   * Under BlockNote this had to *filter the built-in items by key* to hide the
   * unguarded download/delete buttons and splice password-gated ones in their
   * place. Owning the toolbar turns that into plain conditional rendering.
   */
  const renderToolbarExtras = useCallback((tiptapEditor: Editor) => {
    const selected = editor?.getSelection()?.blocks
      ?? (editor ? [editor.getTextCursorPosition().block] : []);
    const block: any = selected.length === 1 ? selected[0] : null;
    const isFile = Boolean(block?.props && typeof block.props.url === "string");

    return (
      <>
        {doc.protected && isFile && (
          <>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("doc.deletePrivateFile")} aria-label={t("doc.deletePrivateFile")}
              onMouseDown={(event) => { event.preventDefault(); void sensitiveAttachmentAction("delete", block); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("doc.downloadPrivateFile")} aria-label={t("doc.downloadPrivateFile")}
              onMouseDown={(event) => { event.preventDefault(); void sensitiveAttachmentAction("download", block); }}>
              <Download className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <TiptapToolbarExtras editor={tiptapEditor} />
      </>
    );
  }, [doc.protected, editor, sensitiveAttachmentAction, t]);

  return {
    passwordRequest, finishPasswordRequest,
    insertAttachment, uploadFile, renderToolbarExtras,
  };
}
