import React from "react";
import { LocalDocItem, LocalDocSearchResult } from "@/lib/localDocs";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, FileInput, FileText, FolderOpen, Loader2, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LocalDocTree } from "./LocalDocTree";
import { LocalDocSearchResults } from "./LocalDocSearchResults";

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
  activePath: string | null;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
  onMove: (relPath: string, targetDir: string) => void;
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
  activePath,
  onOpen,
  onDelete,
  onImport,
  onExport,
  onMove,
}: Props) {
  const t = useT();

  return (
    <Collapsible open={sidebarOpen} onOpenChange={onSidebarOpenChange} asChild>
      <div className={`${sidebarOpen ? "w-80" : "w-11"} h-full shrink-0 border-r border-border bg-sidebar transition-[width] duration-200`}>
        {!sidebarOpen && (
          <div className="flex justify-center pt-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title={t("doc.expandFiles")} aria-label={t("doc.expandFiles")}>
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
          </div>
        )}
        <CollapsibleContent className="h-full">
        <div className="flex flex-col h-full">
        <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" title={t("doc.collapseFiles")} aria-label={t("doc.collapseFiles")}>
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("doc.tabLocal")}</p>
            </div>
            {root && (
              <div className="flex items-center gap-1">
                <Button onClick={() => onNewFile()} className="h-6 px-2.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90">+ {t("doc.newFile")}</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onNewFile("")}><FileText className="h-3.5 w-3.5" /> {t("doc.newFileHere")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onImportFiles()}><FileInput className="h-3.5 w-3.5" /> {t("doc.importMarkdown")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onOpenExportPicker()}><Download className="h-3.5 w-3.5" /> {t("doc.exportAllMarkdown")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {root && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onMount}
                title={root}
                className="w-full h-7 justify-start gap-1.5 px-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate font-mono">{root}</span>
                <span className="ml-auto shrink-0 underline decoration-dotted">{t("doc.changeFolder")}</span>
              </Button>

              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("doc.searchFilesAndContent")}
                className="w-full h-7 px-2.5 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </>
          )}
        </div>

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
              onMove={onMove}
              onCreateInFolder={onNewFile}
            />
          )}
        </div>

        {root && files.length > 0 && (
          <div className="px-3 py-2 border-t border-border shrink-0">
            <span className="text-[10px] text-muted-foreground">{t("doc.total", { n: files.length })}</span>
          </div>
        )}
        </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
