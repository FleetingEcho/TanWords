import React from "react";
import { LocalDocItem, LocalDocSearchResult } from "@/lib/localDocs";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronsRight, Copy, Download, FileInput, FileText, FolderOpen, Loader2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LocalDocTree } from "./LocalDocTree";
import { LocalDocSearchResults } from "./LocalDocSearchResults";
import { LIST_PANEL_WIDTH, LIST_PANEL_COLLAPSED_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import { DocPanelHeader } from "./DocPanelHeader";
import { toast } from "sonner";

interface Props {
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  root: string | null;
  onMount: () => void;
  onNewFile: (directory?: string) => void;
  onImportFiles: () => void;
  onOpenExportPicker: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searching: boolean;
  searchResults: LocalDocSearchResult[];
  files: LocalDocItem[];
  /** True while the mounted folder's file list is being (re)built — a folder with
   *  1000+ files can take a moment, and without this the sidebar just looks empty. */
  filesLoading: boolean;
  activePath: string | null;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
  onExportHtml: (relPath: string) => void;
  onExportPdf: (relPath: string) => void;
  onMove: (relPath: string, targetDir: string) => void;
  /** Batch-selection state, owned by LocalDocsView — see LocalDocTree. */
  selected: ReadonlySet<string>;
  selectionMode: boolean;
  onToggleSelect: (relPath: string, range: boolean) => void;
  onToggleSelectionMode: (relPath: string) => void;
  onSelectFolder: (relPaths: string[], select: boolean) => void;
  onImportFolder: (directory: string) => void;
  onCreateFolder: (parent: string) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  /** The selection action bar, rendered above the file list when non-empty. */
  selectionBar?: React.ReactNode;
  /** The database/local-folder switcher — see DocSourceTabs. */
  sourceTabs?: React.ReactNode;
}

export function LocalDocsSidebar({
  sidebarOpen,
  onSidebarOpenChange,
  root,
  onMount,
  onNewFile,
  onImportFiles,
  onOpenExportPicker,
  search,
  onSearchChange,
  searching,
  searchResults,
  files,
  filesLoading,
  activePath,
  onOpen,
  onDelete,
  onImport,
  onExport,
  onExportHtml,
  onExportPdf,
  onMove,
  selected,
  selectionMode,
  onToggleSelect,
  onToggleSelectionMode,
  onSelectFolder,
  onImportFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  selectionBar,
  sourceTabs,
}: Props) {
  const t = useT();

  return (
    <Collapsible open={sidebarOpen} onOpenChange={onSidebarOpenChange} asChild>
      <div className={`${sidebarOpen ? LIST_PANEL_WIDTH : LIST_PANEL_COLLAPSED_WIDTH} h-full shrink-0 border-r border-border bg-[var(--document-list-surface)] transition-[width] duration-200 ${sidebarOpen ? "max-lg:w-full max-lg:shrink" : "max-lg:w-[60px]"}`}>
        {!sidebarOpen && (
          <div className="flex justify-center pt-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className={`h-7 w-7 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("doc.expandFiles")} aria-label={t("doc.expandFiles")}>
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </CollapsibleTrigger>
          </div>
        )}
        <CollapsibleContent className="h-full">
        <div className="flex flex-col h-full">
        {/* Same two-row header the database panel wears — see DocPanelHeader.
          * The mounted folder's path is the one thing this panel has that the
          * other does not, and it sits below both rows because it describes
          * where the list comes from rather than what you can do to it. */}
        <DocPanelHeader
          sourceTabs={sourceTabs}
          onCollapse={() => onSidebarOpenChange(false)}
          collapseLabel={t("doc.collapseFiles")}
          search={search}
          onSearchChange={onSearchChange}
          searchPlaceholder={t("doc.searchFilesAndContent")}
          searchAriaLabel={t("doc.searchFilesAndContent")}
          showFind={!!root}
          onNew={root ? () => onNewFile() : undefined}
          newLabel={t("doc.newFile")}
          actions={root ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" title={t("doc.more")} aria-label={t("doc.more")}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onNewFile("")}><FileText className="h-3.5 w-3.5" /> {t("doc.newFileHere")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onImportFiles()}><FileInput className="h-3.5 w-3.5" /> {t("doc.importMarkdown")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenExportPicker()}><Download className="h-3.5 w-3.5" /> {t("doc.exportAllMarkdown")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined}
        />

        {root && (
          <div className="flex min-w-0 shrink-0 items-center px-3 pb-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onMount}
              title={root}
              className="h-6 min-w-0 flex-1 justify-start gap-1.5 px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-mono">{root}</span>
              <span className="ml-auto shrink-0 underline decoration-dotted">{t("doc.changeFolder")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("doc.copyFolderPath")}
              aria-label={t("doc.copyFolderPath")}
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                void navigator.clipboard.writeText(root).then(
                  () => toast.success(t("doc.folderPathCopied")),
                  () => toast.error(t("doc.copyFolderPathFailed")),
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {selectionBar}

        {/* File list / empty states */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
          {!root ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-muted-foreground gap-3 px-4">
              <p className="text-sm">{t("doc.noFolderMounted")}</p>
              <p className="text-xs opacity-60">{t("doc.noFolderHint")}</p>
              <Button
                onClick={onMount}
                className="h-7 px-3 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                {t("doc.mountFolder")}
              </Button>
            </div>
          ) : search.trim() ? (
            searching ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("doc.searching")}
              </div>
            ) : searchResults.length > 0 ? (
              <LocalDocSearchResults results={searchResults} query={search.trim()} activePath={activePath} onOpen={onOpen} />
            ) : (
              <div className="py-12 text-center text-xs text-muted-foreground">{t("doc.noSearchResults")}</div>
            )
          ) : filesLoading && files.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("doc.loadingFiles")}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-1">
              <p className="text-sm">{t("doc.noLocalFiles")}</p>
              <p className="text-xs opacity-60">{t("doc.noLocalFilesHint")}</p>
            </div>
          ) : (
            <LocalDocTree
              files={files}
              activePath={activePath}
              onOpen={onOpen}
              onDelete={onDelete}
              onImport={onImport}
              onExport={onExport}
              onExportHtml={onExportHtml}
              onExportPdf={onExportPdf}
              onMove={onMove}
              onCreateInFolder={onNewFile}
              selected={selected}
              selectionMode={selectionMode}
              onToggleSelect={onToggleSelect}
              onToggleSelectionMode={onToggleSelectionMode}
              onSelectFolder={onSelectFolder}
              onImportFolder={onImportFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
            />
          )}
        </div>

        {root && files.length > 0 && (
          <div className="h-9 px-3 border-t border-border flex items-center shrink-0">
            <span className="text-[10px] text-muted-foreground">{t("doc.total", { n: files.length })}</span>
          </div>
        )}
        </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
