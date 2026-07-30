import React, { useEffect, useMemo, useRef, useState } from "react";
import { LocalDocItem } from "@/lib/localDocs";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Copy, Download, FilePlus2, FileText, MoreHorizontal, Trash2 } from "lucide-react";

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

function FileRow({ file, active, depth, rowRef, onOpen, onDelete, onImport, onExport }: {
  file: LocalDocItem;
  active: boolean;
  depth: number;
  rowRef?: React.Ref<HTMLDivElement>;
  onOpen: (relPath: string) => void;
  onDelete: (relPath: string) => void;
  onImport: (relPath: string) => void;
  onExport: (relPath: string) => void;
}) {
  const t = useT();
  return (
    <div
      ref={rowRef}
      draggable
      onClick={() => onOpen(file.rel_path)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-tanwords-localdoc", file.rel_path);
        event.dataTransfer.setData("text/plain", file.rel_path);
      }}
      title={file.rel_path}
      style={{ paddingLeft: `${8 + depth * 10}px` }}
      className={`group flex items-center rounded-lg border pr-2 cursor-pointer active:cursor-grabbing transition-colors ${
        depth === 0 ? "min-h-[52px] gap-2 py-1.5" : "min-h-10 gap-1.5 py-1"
      } ${
        active
          ? "border-primary/25 bg-primary/10 text-foreground shadow-sm shadow-primary/5"
          : "border-transparent text-foreground/90 hover:bg-muted/60"
      }`}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-md ${
        depth === 0 ? "h-8 w-8" : "h-7 w-7"
      } ${
        active ? "bg-primary/15 text-primary" : "bg-muted/70 text-muted-foreground"
      }`}>
        <FileText className={depth === 0 ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${depth === 0 ? "text-[13px] leading-5" : "text-xs leading-4"}`}>
          {file.name.replace(/\.(md|markdown)$/i, "")}
        </p>
      </div>
      {/* Fixed-height slot so swapping date ↔ actions never changes row height */}
      <div className="relative shrink-0 h-5 flex items-center">
        {depth <= 1 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/50 group-hover:hidden">
            {new Date(file.modified_ms).toLocaleDateString()}
          </span>
        )}
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

  if (flat) {
    return (
      <>
        {files.map((f) => (
          <FileRow key={f.rel_path} file={f} active={activePath === f.rel_path} depth={0} rowRef={activePath === f.rel_path ? activeRowRef : undefined} onOpen={onOpen} onDelete={onDelete} onImport={onImport} onExport={onExport} />
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
        {node.files.map((f) => (
          <FileRow key={f.rel_path} file={f} active={activePath === f.rel_path} depth={depth} rowRef={activePath === f.rel_path ? activeRowRef : undefined} onOpen={onOpen} onDelete={onDelete} onImport={onImport} onExport={onExport} />
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
