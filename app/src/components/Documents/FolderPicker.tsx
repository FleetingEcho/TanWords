import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderPlus, Library, LockKeyhole } from "lucide-react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";

/** One row per folder, in tree order, with its depth — the picker only needs
 *  to indent and select, so a flat list beats rebuilding a nested structure. */
function toRows(paths: string[], locked: ReadonlySet<string>) {
  // Ancestors are implied by any nested path, and both callers record them, but
  // a picker that silently dropped one would show an orphan row at depth 2.
  const all = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    for (let i = 0; i < segments.length; i++) all.add(segments.slice(0, i + 1).join("/"));
  }
  return [...all].sort((a, b) => a.localeCompare(b)).map((path) => {
    const segments = path.split("/");
    return {
      path,
      name: segments[segments.length - 1],
      depth: segments.length - 1,
      // Locked anywhere up the chain: what lands here gets encrypted.
      sealed: segments.some((_, i) => locked.has(segments.slice(0, i + 1).join("/"))),
    };
  });
}

/** Asks "which folder?" — and lets one be made on the spot, because being sent
 *  away to create a folder first and then starting over is the kind of round
 *  trip that makes people give up on the feature.
 *
 *  Presentational: the caller supplies the folder list, the wording, and what
 *  creating a folder means, so the same dialog serves the library (rows in a
 *  table) and the local vault (directories on disk). */
export function FolderPicker({
  open, title, hint, confirmLabel, folders, lockedPaths, rootLabel,
  onCreateFolder, onClose, onPick,
}: {
  open: boolean;
  title: string;
  hint: string;
  confirmLabel: string;
  folders: string[];
  /** Folders that encrypt what is filed into them; omit where that has no meaning. */
  lockedPaths?: ReadonlySet<string>;
  /** Name for the top-level destination — "Library root", "Folder root", … */
  rootLabel: string;
  /** Creates `path` and resolves once it exists. Omit to hide the affordance. */
  onCreateFolder?: (path: string) => Promise<void>;
  onClose: () => void;
  onPick: (folder: string) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected("");
    setCreating(false);
    setNewName("");
  }, [open]);

  const rows = useMemo(
    () => toRows(folders, lockedPaths ?? new Set()),
    [folders, lockedPaths],
  );

  const createFolder = async () => {
    const name = newName.trim();
    if (!name || !onCreateFolder) return;
    const path = selected ? `${selected}/${name}` : name;
    try {
      await onCreateFolder(path);
      setSelected(path);
      setCreating(false);
      setNewName("");
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3 p-5 pb-3">
        <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>

      <div className="max-h-[45vh] space-y-0.5 overflow-y-auto px-3">
        <button
          type="button"
          onClick={() => setSelected("")}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
            selected === "" ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-muted/60"
          }`}
        >
          <Library className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-semibold">{rootLabel}</span>
        </button>
        {rows.map((row) => (
          <button
            key={row.path}
            type="button"
            onClick={() => setSelected(row.path)}
            title={row.path}
            style={{ paddingLeft: `${8 + (row.depth + 1) * 14}px` }}
            className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px] transition-colors ${
              selected === row.path ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-muted/60"
            }`}
          >
            {row.sealed ? (
              <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.8} />
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 shrink-0">
                <path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h3l2 2h6.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5H4a1.5 1.5 0 01-1.5-1.5v-9z" strokeLinejoin="round" />
              </svg>
            )}
            <span className="truncate">{row.name}</span>
          </button>
        ))}
      </div>

      {onCreateFolder && (
        <div className="px-3 pt-2">
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createFolder();
                  if (event.key === "Escape") setCreating(false);
                }}
                placeholder={t("doc.folderNamePlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-hidden focus:border-primary/50"
              />
              <Button
                variant="ghost"
                onClick={() => void createFolder()}
                disabled={!newName.trim()}
                className="h-8 shrink-0 rounded-lg px-3 text-xs font-semibold text-primary disabled:opacity-40"
              >
                {t("doc.createFolder")}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setCreating(true)}
              className="h-8 w-full justify-start gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {selected ? t("doc.newFolderIn", { path: selected }) : t("doc.newFolderAtRoot")}
            </Button>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          onClick={onClose}
          className="h-8 rounded-lg px-4 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => onPick(selected)}
          className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
