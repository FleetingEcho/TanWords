import { useLocalDocsView } from "./useLocalDocsView";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { ExportMarkdownDialog } from "./ExportMarkdownDialog";
import { LocalDocsSidebar } from "./LocalDocsSidebar";
import { LocalDocsEditorPane } from "./LocalDocsEditorPane";
import { LibraryFolderPicker } from "./LibraryFolderPicker";
import { FolderPicker } from "./FolderPicker";
import { FolderNameDialog } from "./FolderNameDialog";
import { createLocalDocFolder } from "@/lib/localDocs";
import { ChevronLeft, Download, FolderInput, Loader2 } from "lucide-react";

export function LocalDocsView({
  refreshTick = 0,
  onRefreshingChange,
  sourceTabs,
}: {
  refreshTick?: number;
  onRefreshingChange?: (refreshing: boolean) => void;
  /** Rendered in the file list's header — see DocSourceTabs. */
  sourceTabs?: React.ReactNode;
}) {
  const { root, rootLoaded, files, filesLoading, search, searchResults, searching, activePath, activeContent, activeRawContent, fileLoading, saveStatus, pendingDelete, pendingImport, pendingDuplicates, importing, selectedPaths, selectionMode, newFileFolderOpen, vaultDirs, folderPrompt, pendingFolderDelete, sidebarOpen, showMobileEditor, zenMode, exportPickerOpen, editorKey, t, hasCustomAppBackground, isNarrow, activeMeta, setRoot, setRootLoaded, setFiles, setFilesLoading, setSearch, setSearchResults, setSearching, setActivePath, setActiveContent, setActiveRawContent, setFileLoading, setSaveStatus, setPendingDelete, setPendingImport, setPendingDuplicates, setImporting, setSelectedPaths, setSelectionMode, setNewFileFolderOpen, setVaultDirs, setFolderPrompt, setPendingFolderDelete, setSidebarOpenState, setShowMobileEditor, setZenMode, setExportPickerOpen, setEditorKey, setSidebarOpen, handleMount, handleOpen, handleNewFile, toggleSelectionMode, exitSelectionMode, toggleSelect, selectFolderFiles, promptCreateFolder, promptRenameFolder, confirmDeleteFolder, handleMoveFile, handleImportFiles, handleExportFiles, handleExportHtml, handleExportPdf, handleSave, markDirty, handleUploadImage, toRawMarkdown, toDisplayMarkdown, requestImportToLibrary, requestImportFolder, runImport, confirmImportToLibrary, handleRename, confirmDelete } = useLocalDocsView(refreshTick, onRefreshingChange);

  if (!rootLoaded) return null;

  return (
    <div className={`flex h-full overflow-hidden ${
      zenMode
        ? `fixed inset-0 z-50 ${hasCustomAppBackground ? "" : "bg-background"}`
        : "bg-transparent"
    }`}>
      {/* Sidebar */}
      {!zenMode && (!isNarrow || !showMobileEditor) && (
        <LocalDocsSidebar
          sourceTabs={sourceTabs}
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          root={root}
          onMount={handleMount}
          onNewFile={(directory) => {
            if (directory === undefined) setNewFileFolderOpen(true);
            else void handleNewFile(directory);
          }}
          onImportFiles={() => void handleImportFiles()}
          onOpenExportPicker={() => setExportPickerOpen(true)}
          search={search}
          onSearchChange={setSearch}
          searching={searching}
          searchResults={searchResults}
          files={files}
          filesLoading={filesLoading}
          activePath={activePath}
          onOpen={handleOpen}
          onDelete={setPendingDelete}
          onImport={(relPath) => requestImportToLibrary([relPath])}
          onExport={(relPath) => void handleExportFiles([relPath])}
          onExportHtml={(relPath) => void handleExportHtml(relPath)}
          onExportPdf={(relPath) => void handleExportPdf(relPath)}
          onMove={(relPath, targetDir) => void handleMoveFile(relPath, targetDir)}
          selected={selectedPaths}
          selectionMode={selectionMode}
          onToggleSelect={toggleSelect}
          onToggleSelectionMode={toggleSelectionMode}
          onSelectFolder={selectFolderFiles}
          onImportFolder={requestImportFolder}
          onCreateFolder={promptCreateFolder}
          onRenameFolder={promptRenameFolder}
          onDeleteFolder={setPendingFolderDelete}
          selectionBar={selectionMode ? (
            <div className="mx-2 mb-1 flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 bg-primary/[0.06] px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums text-primary">
                {t("doc.selectedCount", { n: selectedPaths.size })}
              </span>
              {/* Icons, not labels: three labelled buttons plus the count
                * overflowed the panel and pushed "Done" off the edge. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => requestImportToLibrary([...selectedPaths])}
                disabled={importing || selectedPaths.size === 0}
                title={t("doc.importToLibrary")}
                aria-label={t("doc.importToLibrary")}
                className="h-6 w-6 shrink-0 rounded-md text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleExportFiles([...selectedPaths])}
                disabled={selectedPaths.size === 0}
                title={t("doc.exportSelected")}
                aria-label={t("doc.exportSelected")}
                className="h-6 w-6 shrink-0 rounded-md text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                onClick={exitSelectionMode}
                className="h-6 shrink-0 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t("doc.exitSelection")}
              </Button>
            </div>
          ) : undefined}
        />
      )}

      {/* Editor pane */}
      <div className={`flex-1 min-w-0 flex flex-col ${isNarrow && !showMobileEditor ? "max-lg:hidden" : ""}`}>
        {isNarrow && showMobileEditor && (
          <div className="flex h-10 shrink-0 items-center border-b border-border/60 px-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMobileEditor(false)}
              className="h-9 gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("doc.collapseFiles")}
            </Button>
          </div>
        )}
        <LocalDocsEditorPane
          editorKey={editorKey}
          loading={fileLoading}
          activePath={activePath}
          activeContent={activeContent}
          activeRawContent={activeRawContent}
          modifiedMs={activeMeta?.modified_ms ?? 0}
          saveStatus={saveStatus}
          onSave={handleSave}
          onDirty={markDirty}
          onUploadImage={handleUploadImage}
          toRawMarkdown={toRawMarkdown}
          toDisplayMarkdown={toDisplayMarkdown}
          onRename={handleRename}
          zenMode={zenMode}
          onZenModeChange={setZenMode}
        />
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("doc.deleteFileTitle")}
        message={t("doc.deleteFileConfirm")}
        confirmLabel={t("doc.delete")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
      <FolderNameDialog request={folderPrompt} onClose={() => setFolderPrompt(null)} />
      <ConfirmModal
        open={pendingFolderDelete !== null}
        title={t("doc.deleteFolderTitle")}
        message={t("doc.deleteFolderConfirm")}
        confirmLabel={t("doc.delete")}
        onCancel={() => setPendingFolderDelete(null)}
        onConfirm={() => void confirmDeleteFolder()}
      />
      <FolderPicker
        open={newFileFolderOpen}
        title={t("doc.newFileFolderTitle")}
        hint={t("doc.newFileFolderHint")}
        confirmLabel={t("doc.createHere")}
        rootLabel={t("doc.folderRoot")}
        folders={vaultDirs}
        onCreateFolder={async (path) => {
          if (!root) return;
          const created = await createLocalDocFolder(root, path);
          setVaultDirs((current) => [...new Set([...current, created])].sort((a, b) => a.localeCompare(b)));
        }}
        onClose={() => setNewFileFolderOpen(false)}
        onPick={(directory) => {
          setNewFileFolderOpen(false);
          void handleNewFile(directory);
        }}
      />
      <LibraryFolderPicker
        open={pendingImport !== null}
        title={t("doc.importToLibraryTitle")}
        hint={t("doc.importToLibraryHint", { n: pendingImport?.relPaths.length ?? 0 })}
        confirmLabel={t("doc.importHere")}
        onClose={() => setPendingImport(null)}
        onPick={(folder) => void confirmImportToLibrary(folder)}
      />
      <ConfirmModal
        open={pendingDuplicates !== null}
        title={t("doc.duplicateDatabaseTitle")}
        message={t("doc.duplicateDatabaseCountConfirm", { n: pendingDuplicates?.duplicates ?? 0 })}
        confirmLabel={t("doc.copyAnyway")}
        danger={false}
        onCancel={() => setPendingDuplicates(null)}
        onConfirm={() => {
          const pending = pendingDuplicates;
          setPendingDuplicates(null);
          if (pending) void runImport(pending.relPaths, pending.base, pending.folder);
        }}
      />
      <ExportMarkdownDialog
        open={exportPickerOpen}
        items={files.map((file) => ({ id: file.rel_path, label: file.name.replace(/\.(md|markdown)$/i, ""), detail: file.rel_path }))}
        onClose={() => setExportPickerOpen(false)}
        onExport={(paths) => {
          setExportPickerOpen(false);
          void handleExportFiles(paths);
        }}
      />
    </div>
  );
}

