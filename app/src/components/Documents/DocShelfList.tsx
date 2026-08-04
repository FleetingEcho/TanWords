import { FilePlus2, FolderPlus } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DocItem } from "./DocItem";
import { DocFolderTree } from "./DocFolderTree";
import React from "react";
import type { DocumentListItem } from "@/hooks/useDB";
import type { DocListState } from "./hooks/useDocList";
import type { DocActionsState } from "./hooks/useDocActions";

/** The library's document list: one folder tree over everything.
 *
 * It used to be two shelves, Normal and Private, split on `protected`. That
 * made protection a *place* — to encrypt a document you moved it, and a locked
 * document could not also live in the folder it belonged to. Protection is a
 * property, so it is now shown as one: a lock on the row, toggled from its
 * menu, and inherited from a locked folder (document_privacy/folder_lock.rs). */
export function DocShelfList({
  list, actions, activeId, onSelect, onExport,
  onExportHtml, onExportPdf, shelfMenu, setShelfMenu,
  onNewDoc, onNewDocIn, onCreateFolder, onRenameFolder, onSetFolderLocked,
  selectedIds, selectionMode, onToggleSelect, onToggleSelectionMode, selectionBar,
}: {
  list: DocListState;
  actions: DocActionsState;
  activeId: number | null;
  onSelect: (id: number) => void;
  onExport: (id: number) => void;
  onExportHtml: (id: number) => void;
  onExportPdf: (id: number) => void;
  /** Right-click menu on the list background, positioned in viewport coords. */
  shelfMenu: { x: number; y: number } | null;
  setShelfMenu: (v: { x: number; y: number } | null) => void;
  onNewDoc: () => void;
  onNewDocIn: (folder: string) => void;
  /** Prompts for a name, then creates a folder under `parent`. */
  onCreateFolder: (parent: string) => void;
  onRenameFolder: (path: string) => void;
  onSetFolderLocked: (path: string, locked: boolean) => void;
  selectedIds: ReadonlySet<number>;
  selectionMode: boolean;
  onToggleSelect: (id: number, range: boolean) => void;
  onToggleSelectionMode: (id: number) => void;
  /** Rendered above the list while multi-select is on. */
  selectionBar?: React.ReactNode;
}) {
  const t = useT();
  const { docs, folders, loading, search } = list;
  const {
    handleRename, handlePin, handleDuplicate, handleDelete, handlePrivacyAction,
    handleRemoveProtection, handleMoveToFolder, handleDeleteFolder,
  } = actions;

  // While a search is running the tree gets in the way — a result three folders
  // deep would be hidden behind two collapsed rows. Matches show as a flat list,
  // the same shape the local vault's search results take.
  const searching = search.trim().length > 0;

  const renderDoc = (doc: DocumentListItem, inTree = false) => (
    <DocItem
      doc={doc}
      compact={inTree}
      active={activeId === doc.id}
      selected={selectedIds.has(doc.id)}
      selectionMode={selectionMode}
      onToggleSelect={onToggleSelect}
      onToggleSelectionMode={onToggleSelectionMode}
      onSelect={onSelect}
      onRename={handleRename}
      onPin={handlePin}
      onDuplicate={handleDuplicate}
      onDelete={handleDelete}
      searchQuery={search}
      onExport={onExport}
      onExportHtml={onExportHtml}
      onExportPdf={onExportPdf}
      onPrivacyAction={handlePrivacyAction}
      onRemoveProtection={handleRemoveProtection}
    />
  );

  return (
    <>
      {selectionBar}
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          setShelfMenu({ x: event.clientX, y: event.clientY });
        }}
        className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0"
      >
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">Loading…</div>
        ) : searching ? (
          docs.map((doc) => <div key={doc.id}>{renderDoc(doc)}</div>)
        ) : (
          <DocFolderTree
            docs={docs}
            folders={folders}
            renderDoc={(doc) => renderDoc(doc, true)}
            onMove={handleMoveToFolder}
            onNewDocIn={onNewDocIn}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onSetFolderLocked={onSetFolderLocked}
            activeId={activeId}
            selectedIds={selectedIds}
          />
        )}
      </div>

      {shelfMenu && (
        <div
          style={{ position: "fixed", left: shelfMenu.x, top: shelfMenu.y, zIndex: 9999 }}
          onMouseDown={(event) => event.stopPropagation()}
          className="min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <Button
            variant="ghost"
            onClick={() => { setShelfMenu(null); onNewDoc(); }}
            className="h-8 w-full justify-start gap-2 px-2 text-xs"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            {t("doc.newDoc")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setShelfMenu(null); onCreateFolder(""); }}
            className="h-8 w-full justify-start gap-2 px-2 text-xs"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("doc.newFolder")}
          </Button>
        </div>
      )}
    </>
  );
}
