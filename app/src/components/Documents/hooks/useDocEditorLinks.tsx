import React, { useEffect, useState } from "react";
import { invoke } from "@/ipc/backend";
import type { DocEditorInstance } from "./useDocEditorContent";

interface DocumentLinkItem { id: number; title: string }
interface DocumentLinkContext {
  outgoing: DocumentLinkItem[];
  backlinks: DocumentLinkItem[];
  candidates: DocumentLinkItem[];
}

/** Cross-document links: the outgoing/backlink summary shown under the
 * editor, the "insert a link to another document" picker, and following a
 * `tanwords-doc://` link clicked inside the rendered content. */
export function useDocEditorLinks(params: {
  documentId: number;
  documentContent: string;
  editor: DocEditorInstance;
  scheduleSave: () => void;
}) {
  const { documentId, documentContent, editor, scheduleSave } = params;
  const [linkContext, setLinkContext] = useState<DocumentLinkContext>({ outgoing: [], backlinks: [], candidates: [] });
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");

  useEffect(() => {
    // documentContent changes on every autosave — debounce so a typing burst
    // (and its periodic saves) costs one link-context query, not one per save.
    const timer = setTimeout(() => {
      invoke<DocumentLinkContext>("db_get_document_link_context", { documentId })
        .then(setLinkContext)
        .catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [documentId, documentContent]);

  const insertDocumentLink = (target: DocumentLinkItem) => {
    editor.insertInlineContent([{
      type: "link",
      href: `tanwords-doc://${target.id}`,
      content: target.title,
    }]);
    setLinkPickerOpen(false);
    setLinkQuery("");
    scheduleSave();
  };

  const handleEditorClick = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='tanwords-doc://']");
    if (!anchor) return;
    event.preventDefault();
    const id = Number(anchor.getAttribute("href")?.slice("tanwords-doc://".length));
    if (id > 0) window.dispatchEvent(new CustomEvent("tanwords:open-document", { detail: { id } }));
  };

  return {
    linkContext, linkPickerOpen, setLinkPickerOpen, linkQuery, setLinkQuery,
    insertDocumentLink, handleEditorClick,
  };
}
