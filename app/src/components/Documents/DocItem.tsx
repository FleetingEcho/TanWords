import React, { useEffect, useRef, useState } from "react";
import { DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { PinIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { parseDbTimestamp } from "@/lib/dbTime";
import { Copy, FileText, FileType2, FileOutput, LockKeyhole, LockOpen, MapPin, MoreHorizontal, Pencil, ShieldCheck, Trash2 } from "lucide-react";

interface Props {
  doc: DocumentListItem;
  active: boolean;
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
export const DocItem = React.memo(function DocItem({ doc, active, onSelect, onRename, onPin, onDuplicate, onDelete, onExport, onExportHtml, onExportPdf, onPrivacyAction, onRemoveProtection, searchQuery = "" }: Props) {
  const t = useT();
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
        onClick={() => onSelect(doc.id)}
        className={`group min-h-[58px] cursor-pointer rounded-xl border px-2.5 py-2 transition-colors ${
          active
            ? "border-primary/25 bg-primary/10 text-foreground shadow-xs shadow-primary/5"
            : "border-transparent text-foreground/90 hover:bg-muted/60"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            active
              ? "bg-primary/15 text-primary"
              : doc.protected
                ? "bg-muted text-muted-foreground"
                : "bg-muted/70 text-muted-foreground"
          }`}>
            {doc.protected
              ? <LockKeyhole className={`h-4 w-4 ${doc.unlocked ? "text-primary" : ""}`} strokeWidth={1.8} />
              : doc.pinned
              ? <PinIcon filled className="h-4 w-4 text-primary" />
              : <FileText className="h-4 w-4" strokeWidth={1.8} />}
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
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5"><HighlightFuzzy text={doc.title || t("doc.untitled")} query={searchQuery} /></p>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                    title={t("doc.moreActions")}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded p-0 text-muted-foreground/60 opacity-70 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
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
            {excerpt && (
              <p className="mt-1.5 line-clamp-2 text-[10px] font-normal leading-4 text-muted-foreground">
                <HighlightFuzzy text={excerpt} query={searchQuery} />
              </p>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
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
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
