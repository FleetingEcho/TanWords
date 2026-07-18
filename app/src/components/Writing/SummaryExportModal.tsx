import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markdownToBlocks, blocksToStorage } from "@/lib/docFormat";
import { exportMarkdownFiles } from "@/lib/localDocs";
import { useNavStore } from "@/store/navStore";
import type { WritingSummary } from "@/features/writing/types";
import { useT } from "@/hooks/useT";

type Destination = "database" | "folder";

function safeFileName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "Writing Summary";
}

function summaryMarkdown(summary: WritingSummary, title: string, generatedLabel: string) {
  const generated = new Date().toLocaleString();
  return `# ${title}\n\n> ${generatedLabel.replace("{date}", generated)}\n\n${summary.content.trim()}\n`;
}

export function SummaryExportModal({ summary, onClose }: { summary: WritingSummary; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(summary.title);
  const [destination, setDestination] = useState<Destination>("database");
  const [folderPath, setFolderPath] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavStore((s) => s.navigate);

  const save = async () => {
    if (!title.trim()) return;
    const markdown = summaryMarkdown(summary, title.trim(), t("writing.generatedAt", { date: "{date}" }));
    setSaving(true);
    try {
      if (destination === "database") {
        const storage = blocksToStorage(await markdownToBlocks(markdown));
        await invoke("db_create_document_with_content", {
          title: title.trim(),
          content: storage.content,
          contentText: storage.contentText,
          tags: JSON.stringify(["writing-summary"]),
          wordCount: storage.wordCount,
        });
        onClose();
        toast.success(t("writing.generatedDocument"), {
          action: { label: t("writing.openDocuments"), onClick: () => navigate("documents") },
        });
      } else {
        const name = `${safeFileName(title)}.md`;
        await exportMarkdownFiles(folderPath, [{ name, content: markdown }]);
        onClose();
        toast.success(t("writing.savedTo", { path: folderPath }));
      }
    } catch (e) {
      toast.error(t("writing.exportFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const chooseFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: t("writing.chooseSaveFolder") });
    if (typeof picked === "string") {
      setFolderPath(picked);
      setDestination("folder");
    }
  };

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="summary-export-title" className="min-w-0 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background p-5 shadow-2xl">
      <h2 id="summary-export-title" className="text-base font-semibold">{t("writing.exportTitle")}</h2>
      <label className="mt-4 block text-xs font-medium text-muted-foreground">{t("writing.titleLabel")}
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
      </label>
      <fieldset className="mt-5 min-w-0 max-w-full space-y-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">{t("writing.destination")}</legend>
        <label className={`flex min-w-0 max-w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${destination === "database" ? "border-primary bg-primary/5" : "border-border"}`}>
          <input type="radio" name="destination" checked={destination === "database"} onChange={() => setDestination("database")} />
          <span><b>{t("writing.database")}</b><small className="mt-0.5 block text-muted-foreground">{t("writing.databaseHint")}</small></span>
        </label>
        <label className={`flex min-w-0 max-w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${destination === "folder" ? "border-primary bg-primary/5" : "border-border"}`}>
          <input type="radio" name="destination" checked={destination === "folder"} onChange={() => setDestination("folder")} />
          <span className="min-w-0 flex-1 overflow-hidden"><b>{t("writing.localFolder")}</b><small className="mt-0.5 block max-w-full truncate text-muted-foreground" title={folderPath}>{folderPath || t("writing.noFolder")}</small></span>
          <Button type="button" variant="outline" onClick={(e) => { e.preventDefault(); chooseFolder(); }} disabled={saving} className="h-8 shrink-0 px-3 text-xs">{t("writing.chooseFolder")}</Button>
        </label>
      </fieldset>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving} className="h-9 px-4 text-xs">{t("writing.cancel")}</Button>
        <Button onClick={save} disabled={saving || !title.trim() || (destination === "folder" && !folderPath)} className="h-9 px-4 text-xs">{saving ? t("writing.saving") : t("writing.confirmSave")}</Button>
      </div>
    </div>
  </div>;
}
