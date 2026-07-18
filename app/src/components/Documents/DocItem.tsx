import React, { useEffect, useRef, useState } from "react";
import { EllipsisVerticalIcon, PencilIcon, MapPinIcon, DocumentDuplicateIcon, TrashIcon } from "@heroicons/react/24/outline";
import { DocumentListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { PinIcon, DocIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

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
}

const MENU_WIDTH = 160;

function formatDate(iso: string): string {
  const d = new Date(iso);
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

export function DocItem({ doc, active, onSelect, onRename, onPin, onDuplicate, onDelete, onExport, searchQuery = "" }: Props) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(doc.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [menu]);

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ x: rect.right - MENU_WIDTH, y: rect.bottom + 4 });
  };

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
        className={`px-3 py-2.5 rounded-xl cursor-pointer group border transition-colors ${
          active
            ? "bg-primary/10 border-primary/20 text-foreground"
            : "border-transparent hover:bg-muted/60 text-foreground/90"
        }`}
      >
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-0.5">
            {doc.pinned
              ? <PinIcon filled className="w-4 h-4 text-primary" />
              : <DocIcon className="w-4 h-4 text-muted-foreground" />}
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
                  className="flex-1 min-w-0 text-sm font-medium bg-card border border-primary/40 rounded px-1 outline-none"
                />
              ) : (
                <p className="flex-1 min-w-0 text-sm font-medium truncate leading-tight"><HighlightFuzzy text={doc.title || t("doc.untitled")} query={searchQuery} /></p>
              )}
              <Button
                ref={menuBtnRef}
                variant="ghost"
                onClick={openMenu}
                title={t("doc.moreActions")}
                className="shrink-0 w-5 h-5 p-0 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <EllipsisVerticalIcon className="w-3.5 h-3.5" />
              </Button>
            </div>
            {excerpt && (
              <p className="mt-1.5 line-clamp-2 text-[10px] font-normal leading-4 text-muted-foreground">
                <HighlightFuzzy text={excerpt} query={searchQuery} />
              </p>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{formatDate(doc.updated_at)}</span>
              {doc.word_count > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  · {t("doc.wordCount", { n: doc.word_count })}
                </span>
              )}
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions dropdown, anchored to the ⋮ button */}
      {menu && (
        <div
          ref={menuRef}
          style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 9999 }}
          className="bg-popover border border-border rounded-xl shadow-lg py-1 min-w-[160px] animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            onClick={() => { setMenu(null); setRenaming(true); setRenameVal(doc.title); }}
            className="h-auto w-full rounded-none flex items-center justify-start gap-2.5 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <PencilIcon className="w-4 h-4 shrink-0" /> {t("doc.rename")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setMenu(null); onExport(doc.id); }}
            className="h-auto w-full rounded-none flex items-center justify-start gap-2.5 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <DocumentDuplicateIcon className="w-4 h-4 shrink-0" /> {t("doc.exportMarkdown")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setMenu(null); onPin(doc.id); }}
            className="h-auto w-full rounded-none flex items-center justify-start gap-2.5 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <MapPinIcon className="w-4 h-4 shrink-0" /> {doc.pinned ? t("doc.unpin") : t("doc.pin")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setMenu(null); onDuplicate(doc.id); }}
            className="h-auto w-full rounded-none flex items-center justify-start gap-2.5 px-3 py-2 text-sm hover:bg-muted text-left"
          >
            <DocumentDuplicateIcon className="w-4 h-4 shrink-0" /> {t("doc.duplicate")}
          </Button>
          <div className="border-t border-border my-1" />
          <Button
            variant="ghost"
            onClick={() => { setMenu(null); onDelete(doc.id); }}
            className="h-auto w-full rounded-none flex items-center justify-start gap-2.5 px-3 py-2 text-sm hover:bg-destructive/10 text-destructive text-left"
          >
            <TrashIcon className="w-4 h-4 shrink-0" /> {t("doc.delete")}
          </Button>
        </div>
      )}
    </>
  );
}
