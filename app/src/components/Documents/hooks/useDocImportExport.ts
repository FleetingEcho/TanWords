import { useState } from "react";
import { openDialog } from "@/ipc/dialog";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { exportMarkdownBundles, readMarkdownFiles } from "@/lib/localDocs";
import { getDocumentAssets, prepareDocumentAssetsForExport, rewriteDocumentLinksForExport } from "@/lib/documentAssets";
import { blocksToMarkdown, blocksToStorage, contentToBlocks, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid, lowerMermaid } from "../mermaidTransforms";
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

  const handleImport = async () => {
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
  };

  const exportDocuments = async (ids: number[]) => {
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
      const destination = await openDialog({ directory: true, multiple: false });
      if (typeof destination !== "string") return;
      const files = [];
      for (const id of ids) {
        const detail = await db.getDocument(id);
        if (!detail) continue;
        const blocks = lowerMermaid(await contentToBlocks(detail.content));
        const markdown = await blocksToMarkdown(blocks);
        const prepared = prepareDocumentAssetsForExport(
          rewriteDocumentLinksForExport(markdown, allDocuments),
          await getDocumentAssets(id),
        );
        files.push({ name: `${detail.title || t("doc.untitled")}.md`, ...prepared });
      }
      const count = await exportMarkdownBundles(destination, files);
      toast.success(t("doc.exportedCount", { n: count }));
    } catch (error) { toast.error(String(error)); }
  };

  const handleExportAll = async () => {
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
  };

  return { exportChoices, setExportChoices, handleImport, exportDocuments, handleExportAll };
}
