import React, { useEffect, useMemo, useRef, useState } from "react";
import { LocalDocItem } from "@/lib/localDocs";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Copy, Download, FilePlus2, FileText, MoreHorizontal, Trash2, FileType2, FileOutput, Loader2, Check, CheckSquare, FolderInput, FolderPlus, Pencil } from "lucide-react";
import { subscribeToExportBusy } from "@/lib/documentExport";

interface Props {
  files: LocalDocItem[];
  activePath: string | null;
  /** Render a flat list (search results) instead of the folder tree. */
  flat?: boolean;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
  onExportHtml: (relPath: string) => void;
  onExportPdf: (relPath: string) => void;
  onMove: (relPath: string, targetDir: string) => void;
  onCreateInFolder: (directory: string) => void;
  /** True while the list is in multi-select mode: only then do rows show a
   *  checkbox, and only then does a plain click tick instead of opening. */
  selectionMode: boolean;
  /** Double-click on a row: enters multi-select mode (selecting that row), or
   *  leaves it if already in. */
  onToggleSelectionMode: (relPath: string) => void;
  /** Relative paths currently ticked for a batch action. */
  selected: ReadonlySet<string>;
  /** Toggles one path; `range` is a shift-click asking for everything between
   *  the previous anchor and this row. */
  onToggleSelect: (relPath: string, range: boolean) => void;
  /** Ticks (or unticks) every file under a folder in one go. */
  onSelectFolder: (relPaths: string[], select: boolean) => void;
  /** Imports a whole folder subtree into the library. */
  onImportFolder: (directory: string) => void;
  onCreateFolder: (parent: string) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
}

interface DirNode {
  dirs: Map<string, DirNode>;
  files: LocalDocItem[];
}

function buildTree(files: LocalDocItem[]): DirNode {
  const rootNode: DirNode = { dirs: new Map(), files: [] };
  for (const f of files) {
    const segs = f.rel_path.split("/");
    let node = rootNode;
    for (const seg of segs.slice(0, -1)) {
      let child = node.dirs.get(seg);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    node.files.push(f);
  }
  return rootNode;
}

/** The order rows actually appear in: folders first (alphabetical, depth
 *  first), then the files sitting directly in that folder. Exported because
 *  shift-click ranges are resolved by the selection owner (LocalDocsView),
 *  which would otherwise have to guess at the layout this file decides. */
export function localDocRowOrder(files: LocalDocItem[]): string[] {
  const walk = (node: DirNode): string[] => [
    ...[...node.dirs.keys()]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((name) => walk(node.dirs.get(name)!)),
    ...node.files.map((f) => f.rel_path),
  ];
  return walk(buildTree(files));
}

function FileRow({ file, active, depth, rowRef, selected, selectionMode, onToggleSelect, onToggleSelectionMode, onOpen, onDelete, onImport, onExport, onExportHtml, onExportPdf }: {
  file: LocalDocItem;
  active: boolean;
  depth: number;
  rowRef?: React.Ref<HTMLDivElement>;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (relPath: string, range: boolean) => void;
  onToggleSelectionMode: (relPath: string) => void;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
  onExportHtml: (relPath: string) => void;
  onExportPdf: (relPath: string) => void;
}) {
  const t = useT();
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => subscribeToExportBusy(setExportBusy), []);
  return (
    <div
      ref={rowRef}
      draggable
      onClick={(event) => {
        // Cmd/Ctrl or shift turns a click into a selection gesture rather than
        // opening the file — the same bargain Finder and VS Code strike. Once
        // in multi-select mode a plain click does the same, which is what makes
        // it a mode rather than a row of checkboxes.
        if (event.metaKey || event.ctrlKey || event.shiftKey || selectionMode) {
          event.preventDefault();
          onToggleSelect(file.rel_path, event.shiftKey);
          return;
        }
        onOpen(file.rel_path);
      }}
      // Deliberately no click-delay to tell single from double: opening a file
      // is the dominant action and must stay instant, so a double-click opens
      // it *and* enters multi-select. Entering the mode from a file you just
      // opened is coherent; a 200ms lag on every open would not be.
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleSelectionMode(file.rel_path);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-tanwords-localdoc", file.rel_path);
        event.dataTransfer.setData("text/plain", file.rel_path);
      }}
      title={file.rel_path}
      style={{ paddingLeft: `${8 + depth * 10}px` }}
      // One density at every depth: a file is a file, and a root-level row twice
      // the height of the same file one folder down made the tree look like two
      // different lists stacked.
      className={`group flex min-h-10 items-center gap-1.5 rounded-lg border py-1 pr-2 cursor-pointer active:cursor-grabbing transition-colors ${
        selected
          ? "border-primary/40 bg-primary/[0.07] text-foreground"
          : active
          ? "border-primary/25 bg-primary/10 text-foreground shadow-xs shadow-primary/5"
          : "border-transparent text-foreground/90 hover:bg-muted/60"
      }`}
    >
      {selectionMode && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={t("doc.select")}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(file.rel_path, event.shiftKey);
          }}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/80 bg-transparent hover:border-primary/60"
          }`}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
      )}
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
        active ? "bg-primary/15 text-primary" : "bg-muted/70 text-muted-foreground"
      }`}>
        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-4">
          {file.name.replace(/\.(md|markdown)$/i, "")}
        </p>
      </div>
      {/* Fixed-height slot so swapping date ↔ actions never changes row height */}
      <div className="relative shrink-0 h-5 flex items-center">
        <span className="text-[10px] tabular-nums text-muted-foreground/50 group-hover:hidden">
          {new Date(file.modified_ms).toLocaleDateString()}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()} className="absolute right-0 top-0 hidden group-hover:flex data-[state=open]:flex h-5 w-5 rounded bg-muted text-muted-foreground" aria-label={t("doc.more")}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onImport(file.rel_path)}>
              <Copy className="h-3.5 w-3.5" /> {t("doc.copyToDatabase")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport(file.rel_path)}>
              <Download className="h-3.5 w-3.5" /> {t("doc.exportMarkdown")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExportHtml(file.rel_path)} disabled={exportBusy}>
              {exportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileType2 className="h-3.5 w-3.5" />} {t("doc.exportHtml")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExportPdf(file.rel_path)} disabled={exportBusy}>
              {exportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileOutput className="h-3.5 w-3.5" />} {t("doc.exportPdf")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(file.rel_path)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> {t("doc.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function LocalDocTree({ files, activePath, flat, onOpen, onDelete, onImport, onExport, onExportHtml, onExportPdf, onMove, onCreateInFolder, selected, selectionMode, onToggleSelect, onToggleSelectionMode, onSelectFolder, onImportFolder, onCreateFolder, onRenameFolder, onDeleteFolder }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Which folder's menu is open. Held here so a right-click anywhere on the
   *  row can raise the same menu the "..." button does. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildTree(files), [files]);
  const activeParentPath = activePath?.includes("/")
    ? activePath.slice(0, activePath.lastIndexOf("/"))
    : "";

  // Search results replace the tree rather than merely filtering it. When the
  // query is cleared this component mounts again, so reveal the result the user
  // just opened instead of returning them to the top of a long vault.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const rowProps = (f: LocalDocItem, depth: number) => ({
    key: f.rel_path,
    file: f,
    active: activePath === f.rel_path,
    depth,
    rowRef: activePath === f.rel_path ? activeRowRef : undefined,
    selected: selected.has(f.rel_path),
    selectionMode,
    onToggleSelect,
    onToggleSelectionMode,
    onOpen, onDelete, onImport, onExport, onExportHtml, onExportPdf,
  });

  if (flat) {
    return <>{files.map((f) => <FileRow {...rowProps(f, 0)} />)}</>;
  }

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const readDraggedPath = (event: React.DragEvent) =>
    event.dataTransfer.getData("application/x-tanwords-localdoc");

  const acceptDrop = (event: React.DragEvent, targetDir: string) => {
    const relPath = readDraggedPath(event);
    if (!relPath) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    onMove(relPath, targetDir);
  };

  /** Every file at or below `directory`, in vault order. */
  const filesUnder = (directory: string) =>
    files.filter((f) => f.rel_path.startsWith(`${directory}/`)).map((f) => f.rel_path);

  const renderDir = (node: DirNode, path: string, depth: number): React.ReactNode => {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
    return (
      <React.Fragment key={path || "__root__"}>
        {dirNames.map((name) => {
          const compactNames = [name];
          let childNode = node.dirs.get(name)!;
          let childPath = path ? `${path}/${name}` : name;
          while (childNode.files.length === 0 && childNode.dirs.size === 1) {
            const [nextName, nextNode] = [...childNode.dirs.entries()][0];
            compactNames.push(nextName);
            childPath = `${childPath}/${nextName}`;
            childNode = nextNode;
          }
          const isCollapsed = collapsed.has(childPath);
          const isActiveParent = activeParentPath === childPath;
          return (
            <React.Fragment key={childPath}>
              <div
                onClick={() => toggle(childPath)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenuFor(childPath);
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes("application/x-tanwords-localdoc")) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(childPath);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(event) => acceptDrop(event, childPath)}
                title={childPath}
                style={{ paddingLeft: `${8 + depth * 10}px` }}
                className={`group/folder flex min-h-8 items-center gap-1.5 rounded-md py-1 pr-2 text-muted-foreground transition-colors cursor-pointer select-none ${dropTarget === childPath ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40" : "hover:bg-muted/70 hover:text-foreground"}`}
              >
                <svg
                  viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`w-3 h-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                >
                  <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
                  <path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h3l2 2h6.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5H4a1.5 1.5 0 01-1.5-1.5v-9z" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0 truncate text-[13px] font-semibold">
                  {compactNames.map((segment, index) => (
                    <React.Fragment key={`${childPath}-${segment}-${index}`}>
                      {index > 0 && <span className="px-1 text-muted-foreground/35">/</span>}
                      <span>{segment}</span>
                    </React.Fragment>
                  ))}
                </span>
                <DropdownMenu open={menuFor === childPath} onOpenChange={(open) => setMenuFor(open ? childPath : null)}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()} className="ml-auto h-5 w-5 opacity-0 group-hover/folder:opacity-100 data-[state=open]:opacity-100" aria-label={t("doc.more")}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => onCreateInFolder(childPath)}>
                      <FilePlus2 className="h-3.5 w-3.5" /> {t("doc.newFileHere")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onCreateFolder(childPath)}>
                      <FolderPlus className="h-3.5 w-3.5" /> {t("doc.newSubfolder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRenameFolder(childPath)}>
                      <Pencil className="h-3.5 w-3.5" /> {t("doc.renameFolder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onImportFolder(childPath)}>
                      <FolderInput className="h-3.5 w-3.5" /> {t("doc.importFolderToLibrary")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => {
                      const paths = filesUnder(childPath);
                      onSelectFolder(paths, !paths.every((p) => selected.has(p)));
                    }}>
                      <CheckSquare className="h-3.5 w-3.5" /> {t("doc.selectFolderFiles")}
                    </DropdownMenuItem>
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
                  <span
                    aria-hidden
                    style={{ left: `${13 + depth * 10}px` }}
                    className={`pointer-events-none absolute inset-y-0 w-px ${
                      isActiveParent ? "bg-primary/70" : "bg-border/45"
                    }`}
                  />
                  {renderDir(childNode, childPath, depth + 1)}
                </div>
              )}
            </React.Fragment>
          );
        })}
        {node.files.map((f) => <FileRow {...rowProps(f, depth)} />)}
      </React.Fragment>
    );
  };

  return (
    <div
      className={`min-h-full rounded-lg transition-colors ${dropTarget === "" ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-tanwords-localdoc")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget("");
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
      }}
      onDrop={(event) => acceptDrop(event, "")}
    >
      {renderDir(tree, "", 0)}
    </div>
  );
}
