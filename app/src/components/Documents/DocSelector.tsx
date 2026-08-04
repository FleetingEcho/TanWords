import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Download, FolderInput } from "lucide-react";
import { LIST_PANEL_WIDTH } from "@/components/shared/listPanel";
import { ExportMarkdownDialog } from "./ExportMarkdownDialog";
import { DocumentImageManager } from "./DocumentImageManager";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { DocumentPasswordDialog } from "./DocumentPasswordDialog";
import { DocSelectorHeader } from "./DocSelectorHeader";
import { DocShelfList } from "./DocShelfList";
import { FolderNameDialog, type FolderNameRequest } from "./FolderNameDialog";
import { LibraryFolderPicker } from "./LibraryFolderPicker";
import { useDocList } from "./hooks/useDocList";
import { useDocActions } from "./hooks/useDocActions";
import { useDocImportExport } from "./hooks/useDocImportExport";

interface Props {
  activeId: number | null;
  onSelect: (id: number) => void;
  onNewDoc: () => void;
  /** Creates a document already filed in a library folder. */
  onNewDocIn: (folder: string) => void;
  refreshKey: number;
  manualRefreshKey?: number;
  onRefreshingChange?: (refreshing: boolean) => void;
  onCollapse?: () => void;
  /** Passed straight to the header — see DocSourceTabs. */
  sourceTabs?: React.ReactNode;
}

export function DocSelector({ activeId, onSelect, onNewDoc, onNewDocIn, refreshKey, manualRefreshKey = 0, onRefreshingChange, onCollapse, sourceTabs }: Props) {
  const t = useT();
  const list = useDocList(`${refreshKey}:${manualRefreshKey}`);
  const { db, page, load, total, totalPages, loading: listLoading } = list;

  React.useEffect(() => {
    onRefreshingChange?.(listLoading);
  }, [listLoading, onRefreshingChange]);

  const [imagesOpen, setImagesOpen] = useState(false);
  const [shelfMenu, setShelfMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!shelfMenu) return;
    const dismiss = () => setShelfMenu(null);
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [shelfMenu]);

  const actions = useDocActions({ db, activeId, onSelect, load, page });
  const importExport = useDocImportExport({ db, onSelect, load, requestPassword: actions.requestPassword });
  const { exportDocumentHtml, exportDocumentPdf } = importExport;

  const [folderPrompt, setFolderPrompt] = useState<FolderNameRequest | null>(null);
  // The header's "+" used to drop every new document at the library root, which
  // meant filing it was always a second, separate step (and usually a forgotten
  // one). Ask up front instead — the same picker the local import uses.
  const [newDocFolderOpen, setNewDocFolderOpen] = useState(false);

  // Multi-select, entered by double-clicking a row — same gesture and same
  // reasoning as the local vault's list (see LocalDocsView).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionAnchor = React.useRef<number | null>(null);
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    selectionAnchor.current = null;
  };

  const toggleSelectionMode = (id: number) => {
    if (selectionMode) { exitSelection(); return; }
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
    selectionAnchor.current = id;
  };

  const toggleSelect = (id: number, range: boolean) => {
    setSelectionMode(true);
    setSelectedIds((current) => {
      const next = new Set(current);
      const anchor = selectionAnchor.current;
      if (range && anchor !== null && anchor !== id) {
        // The shelf renders in tree order, so range means "between these two
        // rows as displayed" — which is exactly the order `docs` is walked in.
        const order = list.docs.map((doc) => doc.id);
        const from = order.indexOf(anchor);
        const to = order.indexOf(id);
        if (from >= 0 && to >= 0) {
          for (const between of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(between);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    selectionAnchor.current = id;
  };

  // A document deleted or filtered away must not linger as a selected id.
  React.useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const live = new Set(list.docs.map((doc) => doc.id));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [list.docs]);

  const promptCreateFolder = (parent: string) => setFolderPrompt({
    title: t("doc.newFolder"),
    hint: parent ? t("doc.newFolderIn", { path: parent }) : t("doc.newFolderAtRoot"),
    confirmLabel: t("doc.createFolder"),
    onSubmit: (name) => void actions.handleCreateFolder(parent ? `${parent}/${name}` : name),
  });

  const promptRenameFolder = (path: string) => {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    setFolderPrompt({
      title: t("doc.renameFolder"),
      initialValue: path.slice(path.lastIndexOf("/") + 1),
      confirmLabel: t("doc.rename"),
      // Only the leaf segment is editable, so a rename can never relocate the
      // folder by accident — moving one is a drag, same as for a document.
      onSubmit: (name) => void actions.handleRenameFolder(path, parent ? `${parent}/${name}` : name),
    });
  };

  return (
    <div className={`flex flex-col h-full border-r border-border ${LIST_PANEL_WIDTH} shrink-0 max-lg:w-full max-lg:shrink bg-transparent`}>
      <DocSelectorHeader
        list={list}
        sourceTabs={sourceTabs}
        onCollapse={onCollapse}
        onNewDoc={() => setNewDocFolderOpen(true)}
        onOpenImages={() => setImagesOpen(true)}
        onImport={() => void importExport.handleImport()}
        onExportAll={() => void importExport.handleExportAll()}
      />

      <DocShelfList
        list={list}
        actions={actions}
        activeId={activeId}
        onSelect={onSelect}
        onExport={(id) => void importExport.exportDocuments([id])}
        onExportHtml={(id) => void exportDocumentHtml(id)}
        onExportPdf={(id) => void exportDocumentPdf(id)}
        shelfMenu={shelfMenu}
        setShelfMenu={setShelfMenu}
        onNewDoc={onNewDoc}
        onNewDocIn={onNewDocIn}
        onCreateFolder={promptCreateFolder}
        onRenameFolder={promptRenameFolder}
        onSetFolderLocked={(path, locked) => void actions.handleSetFolderLocked(path, locked)}
        selectedIds={selectedIds}
        selectionMode={selectionMode}
        onToggleSelect={toggleSelect}
        onToggleSelectionMode={toggleSelectionMode}
        selectionBar={selectionMode ? (
          <div className="mx-2 mb-1 flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 bg-primary/[0.06] px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums text-primary">
              {t("doc.selectedCount", { n: selectedIds.size })}
            </span>
            {/* Icons, not labels — see the matching bar in LocalDocsView. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMoveTargetOpen(true)}
              disabled={selectedIds.size === 0}
              title={t("doc.moveToFolder")}
              aria-label={t("doc.moveToFolder")}
              className="h-6 w-6 shrink-0 rounded-md text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              <FolderInput className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void importExport.exportDocuments([...selectedIds])}
              disabled={selectedIds.size === 0}
              title={t("doc.exportSelected")}
              aria-label={t("doc.exportSelected")}
              className="h-6 w-6 shrink-0 rounded-md text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              onClick={exitSelection}
              className="h-6 shrink-0 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("doc.exitSelection")}
            </Button>
          </div>
        ) : undefined}
      />

      <LibraryFolderPicker
        open={moveTargetOpen}
        title={t("doc.moveToFolderTitle")}
        hint={t("doc.moveToFolderHint", { n: selectedIds.size })}
        confirmLabel={t("doc.moveHere")}
        onClose={() => setMoveTargetOpen(false)}
        onPick={(folder) => {
          setMoveTargetOpen(false);
          void actions.handleMoveToFolder([...selectedIds], folder);
          exitSelection();
        }}
      />

      <FolderNameDialog request={folderPrompt} onClose={() => setFolderPrompt(null)} />

      <LibraryFolderPicker
        open={newDocFolderOpen}
        title={t("doc.newDocFolderTitle")}
        hint={t("doc.newDocFolderHint")}
        confirmLabel={t("doc.createHere")}
        onClose={() => setNewDocFolderOpen(false)}
        onPick={(folder) => {
          setNewDocFolderOpen(false);
          if (folder) onNewDocIn(folder);
          else onNewDoc();
        }}
      />

      <DocumentPasswordDialog
        request={actions.passwordRequest}
        onCancel={() => actions.finishPasswordRequest(null)}
        onSubmit={(password) => actions.finishPasswordRequest(password)}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2.5 border-t border-border flex items-center justify-between shrink-0">
          <Button
            variant="ghost"
            disabled={page === 0}
            onClick={() => list.setPage((p) => Math.max(0, p - 1))}
            className="h-auto text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            ←
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {t("doc.page", { n: page + 1 })} / {totalPages}
            <span className="ml-1 opacity-60">({t("doc.total", { n: total })})</span>
          </span>
          <Button
            variant="ghost"
            disabled={page >= totalPages - 1}
            onClick={() => list.setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="h-auto text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            →
          </Button>
        </div>
      )}

      <Dialog
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        maxWidth="max-w-[min(94vw,1280px)]"
        className="top-[4vh] h-[88vh] overflow-hidden"
      >
        <DialogTitle className="sr-only">{t("doc.manageDatabaseImages")}</DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setImagesOpen(false)}
          className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
          title={t("common.close")}
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
        <DocumentImageManager writable />
      </Dialog>

      <ConfirmModal
        open={actions.pendingDeleteId !== null}
        title={t("doc.deleteDocTitle")}
        message={t("doc.deleteConfirm")}
        confirmLabel={t("doc.delete")}
        onCancel={() => actions.setPendingDeleteId(null)}
        onConfirm={actions.confirmDelete}
      />
      <ExportMarkdownDialog
        open={importExport.exportChoices !== null}
        items={importExport.exportChoices ?? []}
        onClose={() => importExport.setExportChoices(null)}
        onExport={(ids) => {
          importExport.setExportChoices(null);
          void importExport.exportDocuments(ids.map(Number));
        }}
      />
    </div>
  );
}
