import React, { useMemo, useState } from "react";
import { FilePlus2, FolderPlus, LockKeyhole, LockOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DocumentListItem, DocumentFolder } from "@/hooks/useDB";

/** MIME type carrying a dragged library document's id, so a drop target can
 *  tell one apart from a local-vault file (`application/x-tanwords-localdoc`)
 *  without reading data — `dataTransfer.getData` is unreadable during dragover. */
export const LIBRARY_DOC_MIME = "application/x-tanwords-libdoc";

interface FolderNode {
  dirs: Map<string, FolderNode>;
  docs: DocumentListItem[];
  /** This folder carries the lock itself, rather than inheriting it. */
  locked: boolean;
}

function emptyNode(): FolderNode {
  return { dirs: new Map(), docs: [], locked: false };
}

function nodeAt(root: FolderNode, path: string): FolderNode {
  let node = root;
  for (const segment of path.split("/").filter(Boolean)) {
    let child = node.dirs.get(segment);
    if (!child) {
      child = emptyNode();
      node.dirs.set(segment, child);
    }
    node = child;
  }
  return node;
}

/** Documents at or below a folder. Subfolders count too: the number is most
 *  useful precisely when the folder is collapsed and its contents are out of
 *  sight, and a "2" over a folder holding twenty would be a lie. */
export function subtreeDocCount(node: FolderNode): number {
  let total = node.docs.length;
  for (const child of node.dirs.values()) total += subtreeDocCount(child);
  return total;
}

/** The tree is the union of the documents' own folders and the recorded
 *  (possibly empty) folder paths — see db/documents/folders.rs. */
export function buildFolderTree(docs: DocumentListItem[], folders: DocumentFolder[]): FolderNode {
  const root = emptyNode();
  for (const folder of folders) nodeAt(root, folder.path).locked = folder.locked;
  for (const doc of docs) nodeAt(root, doc.folder || "").docs.push(doc);
  return root;
}

interface Props {
  docs: DocumentListItem[];
  /** Every folder, with its lock state — see db_list_document_folders. */
  folders: DocumentFolder[];
  /** Renders one document row; the tree owns only the folders around them.
   *  `depth` lets the row match the density of the folders it sits under. */
  renderDoc: (doc: DocumentListItem, depth: number) => React.ReactNode;
  onMove: (ids: number[], folder: string) => void;
  onNewDocIn: (folder: string) => void;
  onCreateFolder: (parent: string) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  /** Toggles the lock on a folder. `locked` is the state being moved to. */
  onSetFolderLocked: (path: string, locked: boolean) => void;
  /** The open document, so its folder's guide rail can be highlighted. */
  activeId: number | null;
  /** Ids moved together when the dragged row is one of them. */
  selectedIds: ReadonlySet<number>;
}

/** The library's folder tree, the database-side counterpart of LocalDocTree.
 *  Same interaction vocabulary on purpose — click a folder to fold it, drag a
 *  document onto one to file it there, drop on the background to unfile it. */
export function DocFolderTree({
  docs, folders, renderDoc, onMove, onNewDocIn, onCreateFolder, onRenameFolder, onDeleteFolder,
  onSetFolderLocked, activeId, selectedIds,
}: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Which folder's menu is open, so a right-click on the row raises the same
   *  one the "..." button does. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const tree = useMemo(() => buildFolderTree(docs, folders), [docs, folders]);
  // Null rather than "" when nothing is open: "" is a real folder (the root),
  // and it must not read as "the open document lives here".
  const activeFolder = docs.find((doc) => doc.id === activeId)?.folder ?? null;

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const acceptDrop = (event: React.DragEvent, targetFolder: string) => {
    const raw = event.dataTransfer.getData(LIBRARY_DOC_MIME);
    const draggedId = Number(raw);
    if (!raw || !Number.isFinite(draggedId)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    // Dragging one row of a selection carries the selection; dragging any other
    // row moves just that one.
    onMove(selectedIds.has(draggedId) ? [...selectedIds] : [draggedId], targetFolder);
  };

  const dragOverProps = (path: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(LIBRARY_DOC_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move" as const;
      setDropTarget(path);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: React.DragEvent) => acceptDrop(event, path),
  });

  const renderNode = (
    node: FolderNode,
    path: string,
    depth: number,
    /** True when an ancestor is locked, so this folder is sealed by inheritance. */
    inheritedLock: boolean,
  ): React.ReactNode => {
    const names = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
    return (
      <React.Fragment key={path || "__root__"}>
        {names.map((name) => {
          const childPath = path ? `${path}/${name}` : name;
          const child = node.dirs.get(name)!;
          const isCollapsed = collapsed.has(childPath);
          const isDropTarget = dropTarget === childPath;
          // Only the folder carrying the lock can release it. A subfolder
          // offering "unlock" would be a button that cannot keep its promise —
          // the ancestor would re-seal anything filed there a moment later.
          const sealed = inheritedLock || child.locked;
          return (
            <React.Fragment key={childPath}>
              <div
                onClick={() => toggle(childPath)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenuFor(childPath);
                }}
                {...dragOverProps(childPath)}
                title={childPath}
                style={{ paddingLeft: `${8 + depth * 10}px` }}
                className={`group/folder flex min-h-8 items-center gap-1.5 rounded-md py-1 pr-2 text-muted-foreground transition-colors cursor-pointer select-none ${
                  isDropTarget
                    ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40"
                    : "hover:bg-muted/70 hover:text-foreground"
                }`}
              >
                <svg
                  viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`w-3 h-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                >
                  <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {sealed ? (
                  <LockKeyhole className={`h-3.5 w-3.5 shrink-0 ${child.locked ? "text-primary" : "text-muted-foreground/60"}`} strokeWidth={1.8} />
                ) : (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
                    <path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h3l2 2h6.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5H4a1.5 1.5 0 01-1.5-1.5v-9z" strokeLinejoin="round" />
                  </svg>
                )}
                <span className="min-w-0 truncate text-[13px] font-semibold">{name}</span>
                {/* The count keeps `ml-auto` and stays put on hover. Hiding it
                  * behind the menu button (the pattern the file rows use for
                  * their date) left nothing to push that button to the right
                  * edge, so it slid back against the folder name. */}
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                  {subtreeDocCount(child)}
                </span>
                <DropdownMenu open={menuFor === childPath} onOpenChange={(open) => setMenuFor(open ? childPath : null)}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(event) => event.stopPropagation()}
                      className="ml-1 h-5 w-5 shrink-0 opacity-0 group-hover/folder:opacity-100 data-[state=open]:opacity-100"
                      aria-label={t("doc.more")}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => onNewDocIn(childPath)}>
                      <FilePlus2 className="h-3.5 w-3.5" /> {t("doc.newDocHere")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onCreateFolder(childPath)}>
                      <FolderPlus className="h-3.5 w-3.5" /> {t("doc.newSubfolder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRenameFolder(childPath)}>
                      <Pencil className="h-3.5 w-3.5" /> {t("doc.renameFolder")}
                    </DropdownMenuItem>
                    {inheritedLock ? (
                      <DropdownMenuItem disabled>
                        <LockKeyhole className="h-3.5 w-3.5" /> {t("doc.lockedByParent")}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => onSetFolderLocked(childPath, !child.locked)}>
                        {child.locked
                          ? <><LockOpen className="h-3.5 w-3.5" /> {t("doc.unlockFolder")}</>
                          : <><LockKeyhole className="h-3.5 w-3.5" /> {t("doc.lockFolder")}</>}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => onDeleteFolder(childPath)}
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t("doc.deleteFolder")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!isCollapsed && (
                <div className="relative">
                  {/* The guide rail down the left of a folder's contents. It
                    * lights up for the folder holding the open document, which
                    * is what tells you where you are in a deep tree once the
                    * row itself has scrolled out of view. */}
                  <span
                    aria-hidden
                    style={{ left: `${13 + depth * 10}px` }}
                    className={`pointer-events-none absolute inset-y-0 w-px ${
                      activeFolder === childPath ? "bg-primary/70" : "bg-border/45"
                    }`}
                  />
                  {renderNode(child, childPath, depth + 1, sealed)}
                </div>
              )}
            </React.Fragment>
          );
        })}
        {/* Indented on the same grid as the folder rows, so a document sits
          * just right of the rail its folder drew. */}
        {node.docs.map((doc) => (
          <div key={doc.id} style={{ paddingLeft: `${8 + depth * 10}px` }}>
            {renderDoc(doc, depth)}
          </div>
        ))}
      </React.Fragment>
    );
  };

  return (
    <div
      {...dragOverProps("")}
      className={`min-h-full rounded-lg transition-colors ${
        dropTarget === "" ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
      }`}
    >
      {renderNode(tree, "", 0, false)}
    </div>
  );
}
