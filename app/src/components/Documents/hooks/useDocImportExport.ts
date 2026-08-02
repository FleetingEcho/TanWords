import { useCallback, useState } from "react";
import { openDialog, pickFiles, downloadText } from "@/ipc/dialog";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { exportMarkdownBundles, readMarkdownFiles } from "@/lib/localDocs";
import { isDesktopHost } from "@/platform";
import {
  DOCUMENT_ASSET_SCHEME,
  getDocumentAssets,
  prepareDocumentAssetsForExport,
  rewriteDocumentLinksForExport,
} from "@/lib/documentAssets";
import { blocksToMarkdown, blocksToStorage, contentToBlocks, markdownToBlocks } from "@/lib/docFormat";
import { blocksToMarkdownOffThread, contentToBlocksOffThread } from "@/lib/documentWorkerClient";
import { liftMermaid, lowerMermaid } from "../mermaidTransforms";
import { exportMarkdownAsHtml, exportMarkdownAsPdf } from "@/lib/documentExport";
import type { MarkdownExportChoice } from "../ExportMarkdownDialog";
import type { DocumentPasswordRequest } from "../DocumentPasswordDialog";
import { PAGE_SIZE } from "./useDocList";

/** Bulk markdown import/export — split out of DocSelector because it's a
 * self-contained cluster of file-system operations that only needs `load`
 * and `onSelect` from the rest of the page. */
export function useDocImportExport(params: {
  db: ReturnType<typeof useDB>;
  onSelect: (id: number) => void;
  load: (page?: number) => Promise<void>;
  requestPassword: (request: DocumentPasswordRequest) => Promise<string | null>;
}) {
  const { db, onSelect, load, requestPassword } = params;
  const t = useT();
  const [exportChoices, setExportChoices] = useState<MarkdownExportChoice[] | null>(null);

  // useCallback on every exported handler: DocItem is memoized, so these
  // identities must not churn per render or the memo does nothing.
  const handleImport = useCallback(async () => {
    if (!isDesktopHost) {
      const picked = await pickFiles({ multiple: true, accept: ".md,.markdown,text/markdown" });
      if (!picked.length) return;
      try {
        const sources = await Promise.all(picked.map(async (file) => ({ name: file.name, content: await file.text() })));
        let firstImportedId: number | null = null;
        for (const source of sources) {
          const blocks = liftMermaid(await markdownToBlocks(source.content));
          const { content, contentText, wordCount } = blocksToStorage(blocks);
          const id = await db.createDocument();
          if (firstImportedId === null) firstImportedId = id;
          const title = source.name.replace(/\.(md|markdown)$/i, "");
          await db.updateDocument(id, title, content, contentText, "[]", false, wordCount);
        }
        await load(0);
        if (firstImportedId !== null) onSelect(firstImportedId);
        toast.success(t("doc.importedCount", { n: sources.length }));
      } catch (error) { toast.error(String(error)); }
      return;
    }

    const picked = await openDialog({ multiple: true, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
    const paths = typeof picked === "string" ? [picked] : picked;
    if (!paths?.length) return;
    try {
      const sources = await readMarkdownFiles(paths);
      let firstImportedId: number | null = null;
      for (const source of sources) {
        const blocks = liftMermaid(await markdownToBlocks(source.content));
        const { content, contentText, wordCount } = blocksToStorage(blocks);
        const id = await db.createDocument();
        if (firstImportedId === null) firstImportedId = id;
        const title = source.name.replace(/\.(md|markdown)$/i, "");
        await db.updateDocument(id, title, content, contentText, "[]", false, wordCount);
      }
      await load(0);
      if (firstImportedId !== null) onSelect(firstImportedId);
      toast.success(t("doc.importedCount", { n: sources.length }));
    } catch (error) { toast.error(String(error)); }
  }, [db, load, onSelect, t]);

  const exportDocuments = useCallback(async (ids: number[]) => {
    try {
      const firstPage = await db.getDocuments({ sort: "title", page: 0 });
      const allDocuments = [...firstPage.items];
      for (let nextPage = 1; nextPage < Math.ceil(firstPage.total / PAGE_SIZE); nextPage += 1) {
        allDocuments.push(...(await db.getDocuments({ sort: "title", page: nextPage })).items);
      }
      for (const id of ids) {
        const listItem = allDocuments.find((document) => document.id === id);
        if (!listItem?.protected) continue;
        const password = await requestPassword({
          title: t("doc.exportMarkdown"),
          description: t("doc.exportPasswordPrompt", { title: listItem.title || t("doc.untitled") }),
        });
        if (!password) return;
        try {
          await db.unlockDocument(id, password);
        } catch {
          toast.error(t("doc.invalidPassword"));
          return;
        }
      }
      const files = [];
      for (const id of ids) {
        const detail = await db.getDocument(id);
        if (!detail) continue;
        const blocks = lowerMermaid(await contentToBlocks(detail.content));
        const markdown = await blocksToMarkdown(blocks);
        const allAssets = await getDocumentAssets(id);
        const referencedAssets = allAssets.filter((asset) =>
          markdown.includes(`${DOCUMENT_ASSET_SCHEME}${asset.id}`),
        );
        const prepared = prepareDocumentAssetsForExport(
          rewriteDocumentLinksForExport(markdown, allDocuments),
          referencedAssets,
        );
        files.push({ name: `${detail.title || t("doc.untitled")}.md`, ...prepared });
      }
      if (!isDesktopHost) {
        for (const file of files) {
          downloadText(file.name, (file as { content?: string }).content ?? "");
        }
        toast.success(t("doc.exportedCount", { n: files.length }));
        return;
      }
      const destination = await openDialog({ directory: true, multiple: false });
      if (typeof destination !== "string") return;
      const count = await exportMarkdownBundles(destination, files);
      toast.success(t("doc.exportedCount", { n: count }));
    } catch (error) { toast.error(String(error)); }
  }, [db, requestPassword, t]);

  const documentToDisplayMarkdown = useCallback(async (id: number): Promise<string | null> => {
    const detail = await db.getDocument(id);
    if (!detail) return null;
    const blocks = lowerMermaid(await contentToBlocksOffThread(detail.content));
    return blocksToMarkdownOffThread(blocks);
  }, [db]);

  const exportDocumentHtml = useCallback(async (id: number) => {
    const detail = await db.getDocument(id);
    if (!detail) return;
    try {
      await exportMarkdownAsHtml(detail.title || t("doc.untitled"), await documentToDisplayMarkdown(id) ?? "");
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, documentToDisplayMarkdown, t]);

  const exportDocumentPdf = useCallback(async (id: number) => {
    const detail = await db.getDocument(id);
    if (!detail) return;
    try {
      await exportMarkdownAsPdf(detail.title || t("doc.untitled"), await documentToDisplayMarkdown(id) ?? "");
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, documentToDisplayMarkdown, t]);

  const handleExportAll = useCallback(async () => {
    try {
      const firstPage = await db.getDocuments({ sort: "title", page: 0 });
      const allDocs = [...firstPage.items];
      const pageCount = Math.ceil(firstPage.total / PAGE_SIZE);
      for (let nextPage = 1; nextPage < pageCount; nextPage += 1) {
        const result = await db.getDocuments({ sort: "title", page: nextPage });
        allDocs.push(...result.items);
      }
      setExportChoices(allDocs.filter((doc) => !doc.protected || doc.unlocked).map((doc) => ({
        id: String(doc.id),
        label: doc.title || t("doc.untitled"),
        detail: doc.content_text.slice(0, 100),
        searchText: doc.content_text,
      })));
    } catch (error) {
      toast.error(String(error));
    }
  }, [db, t]);

  return {
    exportChoices, setExportChoices, handleImport, exportDocuments, handleExportAll,
    exportDocumentHtml, exportDocumentPdf,
  };
}
