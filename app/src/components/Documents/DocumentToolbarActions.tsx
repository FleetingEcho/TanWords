import { useEffect, useState } from "react";
import { Code2, Download, Eye, FileText, History, Link2, Loader2, MoreHorizontal, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/useT";
import { subscribeToExportBusy } from "@/lib/documentExport";

interface Props {
  mode: "rich" | "raw";
  switching: boolean;
  attachmentBusy?: boolean;
  onMode: (mode: "rich" | "raw") => void;
  onAttach: () => void;
  onInsertLink?: () => void;
  templatesMenu: React.ReactNode;
  onHistory: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  documentFontSize: number;
  onFontSizeChange: (px: number) => void;
}

export function DocumentToolbarActions({
  mode,
  switching,
  attachmentBusy = false,
  onMode,
  onAttach,
  onInsertLink,
  templatesMenu,
  onHistory,
  onExportHtml,
  onExportPdf,
  documentFontSize,
  onFontSizeChange,
}: Props) {
  const t = useT();
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => subscribeToExportBusy(setExportBusy), []);

  return (
    <div className="document-toolbar-scroll flex w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onAttach}
        disabled={attachmentBusy}
        title={t("doc.attachFile")}
        aria-label={t("doc.attachFile")}
        className="h-7 w-7 rounded-lg text-muted-foreground"
      >
        <Paperclip className="h-3.5 w-3.5" />
      </Button>

      {onInsertLink && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onInsertLink}
          title={t("doc.insertDocumentLink")}
          aria-label={t("doc.insertDocumentLink")}
          className="h-7 w-7 rounded-lg text-muted-foreground"
        >
          <Link2 className="h-3.5 w-3.5" />
        </Button>
      )}

      {templatesMenu}

      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
        <Button
          type="button"
          variant="ghost"
          disabled={switching || attachmentBusy}
          onClick={() => onMode("rich")}
          title={t("doc.richMode")}
          aria-label={t("doc.richMode")}
          className={`h-6 w-6 rounded-md p-0 ${mode === "rich" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={switching || attachmentBusy}
          onClick={() => onMode("raw")}
          title={t("doc.rawMode")}
          aria-label={t("doc.rawMode")}
          className={`h-6 w-6 rounded-md p-0 ${mode === "raw" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
        >
          <Code2 className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-0.5 h-3.5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={documentFontSize <= 12}
          onClick={() => onFontSizeChange(documentFontSize - 1)}
          title={`${t("settings.documentFontSize")}: ${documentFontSize - 1}px`}
          aria-label={`${t("settings.documentFontSize")} -`}
          className="h-6 w-6 rounded-md p-0 text-muted-foreground"
        >
          <span className="text-[11px] font-semibold">A−</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={documentFontSize >= 24}
          onClick={() => onFontSizeChange(documentFontSize + 1)}
          title={`${t("settings.documentFontSize")}: ${documentFontSize + 1}px`}
          aria-label={`${t("settings.documentFontSize")} +`}
          className="h-6 w-6 rounded-md p-0 text-muted-foreground"
        >
          <span className="text-[13px] font-semibold">A+</span>
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title={t("doc.moreActions")}
            aria-label={t("doc.moreActions")}
            className="h-7 w-7 rounded-lg text-muted-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={onHistory} className="gap-2">
            <History className="h-3.5 w-3.5" /> {t("doc.historyTitle")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExportHtml} disabled={exportBusy} className="gap-2">
            {exportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {t("doc.exportHtml")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExportPdf} disabled={exportBusy} className="gap-2">
            {exportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {t("doc.exportPdf")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
