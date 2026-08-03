import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { toast } from "sonner";
import { FormattingToolbar, getFormattingToolbarItems } from "@blocknote/react";
import { Download, Trash2 } from "lucide-react";
import { DocumentDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { uploadDocumentAsset } from "@/lib/documentAssets";
import { refreshCodeBlockTheme } from "../codeBlockTheme";
import { DocumentPasswordRequest } from "../DocumentPasswordDialog";
import { requiresAttachmentPassword, type PrivateAttachmentAction } from "../privateDocumentPolicy";
import type { DocEditorInstance } from "./useDocEditorContent";
import { ImageOptionsButton } from "../ImageOptionsButton";
import { EditorAiButton } from "../EditorAiButton";

/** Attachments (uploading a file into the document, previewing/deleting one
 * through the formatting toolbar) and the password gate a protected
 * document puts in front of downloading or deleting a private file. */
export function useDocEditorAttachments(params: {
  doc: DocumentDetail;
  editor: DocEditorInstance;
  isDark: boolean;
  scheduleSave: () => void;
}) {
  const { doc, editor, isDark, scheduleSave } = params;
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

  useEffect(() => {
    refreshCodeBlockTheme(editor);
  }, [editor, isDark]);

  /** Stores a file and hands back its URL, without touching the rich editor.
   *  Raw Markdown mode writes its own link and needs only this half. */
  const uploadFile = useCallback((file: File) => uploadDocumentAsset(doc.id, file), [doc.id]);

  const insertAttachment = async (file: File | undefined) => {
    if (!file) return;
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

  const handleRichEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, selectRichEditorContents: (root: HTMLElement) => void) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return;
    if (!(event.target as Element).closest(".bn-editor")) return;
    event.preventDefault();
    event.stopPropagation();
    selectRichEditorContents(event.currentTarget);
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

  const formattingToolbar = useCallback(() => {
    const defaults = getFormattingToolbarItems();
    if (!doc.protected) {
      return (
        <FormattingToolbar>
          {defaults}
          <ImageOptionsButton />
          <EditorAiButton />
        </FormattingToolbar>
      );
    }
    const selected = editor.getSelection()?.blocks || [editor.getTextCursorPosition().block];
    const block: any = selected.length === 1 ? selected[0] : null;
    const isFile = Boolean(block?.props && typeof block.props.url === "string");
    const items = defaults.filter((item) =>
      item.key !== "fileDeleteButton" && item.key !== "fileDownloadButton"
    );
    if (isFile) {
      const insertAt = Math.max(0, items.findIndex((item) => item.key === "filePreviewButton"));
      items.splice(
        insertAt,
        0,
        <button key="protectedFileDelete" type="button" className="bn-button mx-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md" title={t("doc.deletePrivateFile")}
          onClick={() => void sensitiveAttachmentAction("delete", block)}>
          <Trash2 className="h-4 w-4" />
        </button>,
        <button key="protectedFileDownload" type="button" className="bn-button mx-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md" title={t("doc.downloadPrivateFile")}
          onClick={() => void sensitiveAttachmentAction("download", block)}>
          <Download className="h-4 w-4" />
        </button>,
      );
    }
    return (
      <FormattingToolbar>
        {items}
        <ImageOptionsButton />
        <EditorAiButton />
      </FormattingToolbar>
    );
  }, [doc.protected, editor, sensitiveAttachmentAction, t]);

  return {
    passwordRequest, finishPasswordRequest,
    insertAttachment, uploadFile, handleRichEditorKeyDown, formattingToolbar,
  };
}
