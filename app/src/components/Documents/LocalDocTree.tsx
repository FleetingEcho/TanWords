import React, { useMemo, useState } from "react";
import { LocalDocItem } from "@/lib/localDocs";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Copy, Download, FilePlus2, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";

interface Props {
  files: LocalDocItem[];
  activePath: string | null;
  /** Render a flat list (search results) instead of the folder tree. */
  flat?: boolean;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
  onMove: (relPath: string, targetDir: string) => void;
  onCreateInFolder: (directory: string) => void;
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

function FileRow({ file, active, depth, onOpen, onDelete, onImport, onExport }: {
  file: LocalDocItem;
  active: boolean;
  depth: number;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
}) {
  const t = useT();
  return (
    <div
      onClick={() => onOpen(file.rel_path)}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
      className={`group flex items-center gap-2 pr-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
        active ? "bg-primary/10 text-foreground" : "hover:bg-muted text-foreground/80"
      }`}
    >
      <span
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-tanwords-localdoc", file.rel_path);
          event.dataTransfer.setData("text/plain", file.rel_path);
        }}
        className="flex h-5 w-3.5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 opacity-50 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
        title={t("doc.dragToMove")}
        aria-label={t("doc.dragToMove")}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60">
        <path d="M6 3h6l3 3v11a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinejoin="round" />
        <path d="M12 3v3h3" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{file.name.replace(/\.(md|markdown)$/i, "")}</p>
      </div>
      {/* Fixed-height slot so swapping date ↔ actions never changes row height */}
      <div className="relative shrink-0 h-5 flex items-center">
        <span className="text-[10px] text-muted-foreground/60 group-hover:hidden">
          {new Date(file.modified_ms).toLocaleDateString()}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()} className="absolute right-0 top-0 hidden group-hover:flex data-[state=open]:flex h-5 w-5 bg-muted text-muted-foreground" aria-label={t("doc.more")}>
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
            <DropdownMenuItem onSelect={() => onDelete(file.rel_path)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> {t("doc.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function LocalDocTree({ files, activePath, flat, onOpen, onDelete, onImport, onExport, onMove, onCreateInFolder }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tree = useMemo(() => buildTree(files), [files]);

  if (flat) {
    return (
      <>
        {files.map((f) => (
          <FileRow key={f.rel_path} file={f} active={activePath === f.rel_path} depth={0} onOpen={onOpen} onDelete={onDelete} onImport={onImport} onExport={onExport} />
        ))}
      </>
    );
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

  const renderDir = (node: DirNode, path: string, depth: number): React.ReactNode => {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
    return (
      <React.Fragment key={path || "__root__"}>
        {dirNames.map((name) => {
          const childPath = path ? `${path}/${name}` : name;
          const isCollapsed = collapsed.has(childPath);
          return (
            <React.Fragment key={childPath}>
              <div
                onClick={() => toggle(childPath)}
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
                style={{ paddingLeft: `${10 + depth * 14}px` }}
                className={`group/folder flex items-center gap-1.5 pr-2.5 py-1.5 rounded-lg cursor-pointer text-muted-foreground transition-colors select-none ${dropTarget === childPath ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40" : "hover:bg-muted"}`}
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
                <span className="text-xs font-medium truncate">{name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()} className="ml-auto h-5 w-5 opacity-0 group-hover/folder:opacity-100 data-[state=open]:opacity-100" aria-label={t("doc.more")}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => onCreateInFolder(childPath)}>
                      <FilePlus2 className="h-3.5 w-3.5" /> {t("doc.newFileHere")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!isCollapsed && renderDir(node.dirs.get(name)!, childPath, depth + 1)}
            </React.Fragment>
          );
        })}
        {node.files.map((f) => (
          <FileRow key={f.rel_path} file={f} active={activePath === f.rel_path} depth={depth} onOpen={onOpen} onDelete={onDelete} onImport={onImport} onExport={onExport} />
        ))}
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
