import React, { useEffect, useRef, useState } from "react";
import { DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { PinIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { parseDbTimestamp } from "@/lib/dbTime";
import { Check, Copy, FileText, FileType2, FileOutput, LockKeyhole, LockOpen, MapPin, MoreHorizontal, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { LIBRARY_DOC_MIME } from "./DocFolderTree";

interface Props {
  doc: DocumentListItem;
  active: boolean;
  /** Set for rows drawn inside the folder tree — see the note in the component. */
  compact?: boolean;
  selected?: boolean;
  /** True while the list is in multi-select mode; only then is there a tick box. */
  selectionMode?: boolean;
  onToggleSelect?: (id: number, range: boolean) => void;
  onToggleSelectionMode?: (id: number) => void;
  onSelect: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onPin: (id: number) => void;
  onDuplicate: (id: number) => void;
  onDelete: (id: number) => void;
  searchQuery?: string;
  onExport: (id: number) => void;
  onExportHtml: (id: number) => void;
  onExportPdf: (id: number) => void;
  onPrivacyAction: (doc: DocumentListItem) => void;
  onRemoveProtection: (doc: DocumentListItem) => void;
}

function formatDate(iso: string): string {
  const d = parseDbTimestamp(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function fuzzyPositions(text: string, query: string): number[] | null {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const positions: number[] = [];
  let cursor = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    positions.push(found);
    cursor = found + 1;
  }
  return positions;
}

function HighlightFuzzy({ text, query }: { text: string; query: string }) {
  const positions = fuzzyPositions(text, query);
  if (!positions) return <>{text}</>;
  const matched = new Set(positions);
  return <>{[...text].map((char, index) => matched.has(index)
    ? <mark key={index} className="rounded-sm bg-yellow-300/70 text-inherit dark:bg-yellow-500/40">{char}</mark>
    : char)}</>;
}

function contentExcerpt(content: string, query: string): string | null {
  const normalized = content.replace(/\s+/g, " ").trim();
  const positions = fuzzyPositions(normalized, query);
  if (!positions) return null;
  const start = Math.max(0, positions[0] - 32);
  const end = Math.min(normalized.length, positions[positions.length - 1] + 72);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

/** Memoized: with large libraries (PAGE_SIZE is 10k) every autosave rebuilds
 * the shelf arrays, and without this each save reconciles every row. Identity
 * stability holds up because the list patches items in place (useDocList's
 * docs-item-updated listener) and all handlers are useCallback'd above. */
export const DocItem = React.memo(function DocItem({ doc, active, compact = false, selected = false, selectionMode = false, onToggleSelect, onToggleSelectionMode, onSelect, onRename, onPin, onDuplicate, onDelete, onExport, onExportHtml, onExportPdf, onPrivacyAction, onRemoveProtection, searchQuery = "" }: Props) {
  const t = useT();
  // `compact` is set for every row inside the folder tree and for none of the
  // flat search results. A roomy two-line card is right when documents are the
  // only thing on screen; beside 32px folder rows it makes the folders look
  // like labels on the files rather than containers of them. Keying it on the
  // *list* rather than on depth is what keeps a file the same size whichever
  // folder it happens to sit in.
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(doc.title);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    const val = renameVal.trim() || t("doc.untitled");
    setRenameVal(val);
    setRenaming(false);
    onRename(doc.id, val);
  };

  const tags: string[] = (() => { try { return JSON.parse(doc.tags); } catch { return []; } })();
  const excerpt = searchQuery.trim() ? contentExcerpt(doc.content_text, searchQuery) : null;

  return (
    <>
      <div
        onClick={(event) => {
          // Same bargain as LocalDocTree's rows: modifier-click, or any click
          // once multi-select is on, ticks instead of opening.
          if (event.metaKey || event.ctrlKey || event.shiftKey || selectionMode) {
            event.preventDefault();
            onToggleSelect?.(doc.id, event.shiftKey);
            return;
          }
          onSelect(doc.id);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleSelectionMode?.(doc.id);
        }}
        // Renaming puts a text input in this row; a draggable ancestor makes
        // the browser start a drag instead of letting the caret select text.
        draggable={!renaming}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(LIBRARY_DOC_MIME, String(doc.id));
          event.dataTransfer.setData("text/plain", doc.title);
        }}
        className={`group cursor-pointer rounded-xl border transition-colors active:cursor-grabbing ${
          compact ? "min-h-10 px-2 py-1" : "min-h-[58px] px-2.5 py-2"
        } ${
          selected
            ? "border-primary/40 bg-primary/[0.07] text-foreground"
            : active
            ? "border-primary/25 bg-primary/10 text-foreground shadow-xs shadow-primary/5"
            : "border-transparent text-foreground/90 hover:bg-muted/60"
        }`}
      >
        <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2.5"}`}>
          {selectionMode && (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={t("doc.select")}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect?.(doc.id, event.shiftKey);
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
          <span className={`flex shrink-0 items-center justify-center rounded-lg ${
            compact ? "h-7 w-7" : "h-8 w-8"
          } ${
            active
              ? "bg-primary/15 text-primary"
              : doc.protected
                ? "bg-muted text-muted-foreground"
                : "bg-muted/70 text-muted-foreground"
          }`}>
            {doc.protected
              ? <LockKeyhole className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} ${doc.unlocked ? "text-primary" : ""}`} strokeWidth={1.8} />
              : doc.pinned
              ? <PinIcon filled className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} text-primary`} />
              : <FileText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={1.8} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              {renaming ? (
                <input
                  ref={renameRef}
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") { setRenaming(false); setRenameVal(doc.title); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 text-sm font-medium bg-card border border-primary/40 rounded px-1 outline-hidden"
                />
              ) : (
                <p className={`min-w-0 flex-1 truncate font-semibold ${compact ? "text-xs leading-4" : "text-[13px] leading-5"}`}><HighlightFuzzy text={doc.title || t("doc.untitled")} query={searchQuery} /></p>
              )}
              {/* Fixed-height slot so swapping date <-> actions never changes
                * row height — the same arrangement LocalDocTree's FileRow uses. */}
              <div className={compact ? "relative ml-auto h-5 shrink-0 flex items-center" : "contents"}>
              {compact && (
                <span className="text-[10px] tabular-nums text-muted-foreground/50 group-hover:hidden">
                  {formatDate(doc.updated_at)}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                    title={t("doc.moreActions")}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded p-0 text-muted-foreground/60 transition-all hover:bg-muted hover:text-foreground data-[state=open]:opacity-100 ${
                      compact
                        ? "absolute right-0 top-0 hidden bg-muted group-hover:flex data-[state=open]:flex"
                        : "opacity-70 group-hover:opacity-100"
                    }`}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    disabled={doc.protected && !doc.unlocked}
                    onSelect={() => { setRenaming(true); setRenameVal(doc.title); }}
                    className="gap-2.5 text-sm"
                  >
                    <Pencil className="w-4 h-4 shrink-0" /> {t("doc.rename")}
                  </DropdownMenuItem>
                  {doc.protected && (
                    <DropdownMenuItem onSelect={() => onRemoveProtection(doc)} className="gap-2.5 text-sm">
                      <ShieldCheck className="w-4 h-4 shrink-0" /> {t("doc.removeProtection")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => onExport(doc.id)} className="gap-2.5 text-sm">
                    <Copy className="w-4 h-4 shrink-0" /> {t("doc.exportMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={doc.protected && !doc.unlocked}
                    onSelect={() => onExportHtml(doc.id)}
                    className="gap-2.5 text-sm"
                  >
                    <FileType2 className="w-4 h-4 shrink-0" /> {t("doc.exportHtml")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={doc.protected && !doc.unlocked}
                    onSelect={() => onExportPdf(doc.id)}
                    className="gap-2.5 text-sm"
                  >
                    <FileOutput className="w-4 h-4 shrink-0" /> {t("doc.exportPdf")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={doc.protected && !doc.unlocked}
                    onSelect={() => onPin(doc.id)}
                    className="gap-2.5 text-sm"
                  >
                    <MapPin className="w-4 h-4 shrink-0" /> {doc.pinned ? t("doc.unpin") : t("doc.pin")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={doc.protected && !doc.unlocked}
                    onSelect={() => onDuplicate(doc.id)}
                    className="gap-2.5 text-sm"
                  >
                    <Copy className="w-4 h-4 shrink-0" /> {t("doc.duplicate")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onPrivacyAction(doc)} className="gap-2.5 text-sm">
                    {doc.protected
                      ? doc.unlocked
                        ? <LockOpen className="w-4 h-4 shrink-0" />
                        : <LockKeyhole className="w-4 h-4 shrink-0" />
                      : <ShieldCheck className="w-4 h-4 shrink-0" />}
                    {doc.protected
                      ? doc.unlocked ? t("doc.lockNow") : t("doc.unlock")
                      : t("doc.protect")}
                  </DropdownMenuItem>
                  <div className="my-1 h-px bg-border" />
                  <DropdownMenuItem
                    disabled={doc.protected && !doc.unlocked}
                    onSelect={() => onDelete(doc.id)}
                    className="gap-2.5 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" /> {t("doc.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </div>
            {excerpt && (
              <p className="mt-1.5 line-clamp-2 text-[10px] font-normal leading-4 text-muted-foreground">
                <HighlightFuzzy text={excerpt} query={searchQuery} />
              </p>
            )}
            {!compact && <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{formatDate(doc.updated_at)}</span>
              {!doc.protected && doc.word_count > 0 && (
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  · {t("doc.wordCount", { n: doc.word_count })}
                </span>
              )}
              {tags.slice(0, 2).map((tag) => (
                <span key={tag} className="min-w-0 truncate rounded bg-muted/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>}
          </div>
        </div>
      </div>
    </>
  );
});
