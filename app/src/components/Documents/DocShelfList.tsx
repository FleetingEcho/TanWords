import { ChevronDown, FilePlus2, LockKeyhole, Plus } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { DocItem } from "./DocItem";
import type { DocumentListItem } from "@/hooks/useDB";
import type { DocListState } from "./hooks/useDocList";
import type { DocActionsState } from "./hooks/useDocActions";

/** The normal/private document shelves, each collapsible with its own
 * right-click "new document here" menu. Split out of DocSelector purely for
 * size — it's a single self-contained block reading from useDocList and
 * useDocActions. */
export function DocShelfList({
  list, actions, activeId, onSelect, onExport,
  onExportHtml, onExportPdf, normalOpen, setNormalOpen, privateOpen, setPrivateOpen,
  shelfMenu, setShelfMenu, createInShelf,
}: {
  list: DocListState;
  actions: DocActionsState;
  activeId: number | null;
  onSelect: (id: number) => void;
  onExport: (id: number) => void;
  onExportHtml: (id: number) => void;
  onExportPdf: (id: number) => void;
  normalOpen: boolean;
  setNormalOpen: (v: boolean) => void;
  privateOpen: boolean;
  setPrivateOpen: (v: boolean) => void;
  shelfMenu: { x: number; y: number; private: boolean } | null;
  setShelfMenu: (v: { x: number; y: number; private: boolean } | null) => void;
  createInShelf: (privateShelf: boolean) => void;
}) {
  const t = useT();
  const { docs, loading, search } = list;
  const { handleRename, handlePin, handleDuplicate, handleDelete, handlePrivacyAction, handleRemoveProtection } = actions;

  const groups: { key: string; label: string; items: DocumentListItem[]; open: boolean; setOpen: (v: boolean) => void }[] = [
    { key: "normal", label: t("doc.normalGroup"), items: docs.filter((doc) => !doc.protected), open: normalOpen, setOpen: setNormalOpen },
    { key: "private", label: t("doc.privateGroup"), items: docs.filter((doc) => doc.protected), open: privateOpen, setOpen: setPrivateOpen },
  ];

  return (
    <>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">Loading…</div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="mb-1.5">
              <div
                onContextMenu={(event) => {
                  event.preventDefault();
                  setShelfMenu({ x: event.clientX, y: event.clientY, private: group.key === "private" });
                }}
                className="group/shelf flex w-full items-center px-1 pb-1 pt-1.5 text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => {
                    const next = !group.open;
                    group.setOpen(next);
                    localStorage.setItem(`tanwords_docs_${group.key}_open`, next ? "1" : "0");
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] hover:text-foreground"
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${group.open ? "" : "-rotate-90"}`} />
                  {group.key === "private" && <LockKeyhole className="h-3 w-3" />}
                  <span>{group.label}</span>
                  <span className="ml-auto min-w-5 rounded-full bg-muted px-1.5 py-px text-center tabular-nums text-muted-foreground">{group.items.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => createInShelf(group.key === "private")}
                  className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                  title={group.key === "private" ? t("doc.newPrivateDoc") : t("doc.newDoc")}
                  aria-label={group.key === "private" ? t("doc.newPrivateDoc") : t("doc.newDoc")}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {group.open && group.items.map((doc) => (
                <DocItem
                  key={doc.id}
                  doc={doc}
                  active={activeId === doc.id}
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
              ))}
            </div>
          ))
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
            onClick={() => createInShelf(shelfMenu.private)}
            className="h-8 w-full justify-start gap-2 px-2 text-xs"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            {shelfMenu.private ? t("doc.newPrivateDoc") : t("doc.newDoc")}
          </Button>
        </div>
      )}
    </>
  );
}
