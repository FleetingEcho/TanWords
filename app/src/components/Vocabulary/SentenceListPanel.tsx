import React from "react";
import { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles } from "lucide-react";

interface Props {
  items: PatternItem[];
  selectedId: number | null;
  search: string;
  page: number;
  pageSize: number;
  onSearchChange: (v: string) => void;
  onSelect: (item: PatternItem) => void;
  onPageChange: (p: number) => void;
  onOpenAdd: () => void;
  onOpenGenerate: () => void;
}

/** Sentence library list — mirrors WordListPanel's layout so the Sentences
 *  tab reads like a sibling of the Words tab instead of a bolted-on page. */
export function SentenceListPanel({
  items, selectedId, search, page, pageSize,
  onSearchChange, onSelect, onPageChange, onOpenAdd, onOpenGenerate,
}: Props) {
  const t = useT();
  const totalPages = Math.ceil(items.length / pageSize);
  const paged = items.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="w-80 shrink-0 border-r border-border bg-card flex flex-col h-full">
      <div className="px-4 pt-5 pb-3 space-y-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold">{t("vocab.patterns.title")}</h2>
          <span className="text-sm text-muted-foreground">{items.length}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={onOpenAdd}
              title={t("vocab.patterns.addTooltip")}
              className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              onClick={onOpenGenerate}
              title={t("vocab.patterns.genTooltip")}
              className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("vocab.patterns.searchPlaceholder")}
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {paged.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {items.length === 0 && !search ? t("vocab.patterns.empty") : t("vocab.patterns.noMatch")}
          </div>
        )}
        {paged.map((item) => {
          const sentence = item.examples[0]?.sentence ?? item.pattern;
          return (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              className={`px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${selectedId === item.id ? "bg-accent/50" : ""}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-sm truncate">{sentence}</span>
                <LevelBadge level={item.level} />
                <SpeakButton text={sentence} className="w-3.5 h-3.5" />
              </div>
              {item.zh && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.zh}</p>}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="shrink-0 border-t border-border px-3 py-2 flex items-center justify-between gap-1">
          <Button
            variant="ghost"
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={page === 0}
            className="w-7 h-7 p-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M9.78 12.78a.75.75 0 01-1.06 0L4.47 8.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L6.06 8l3.72 3.72a.75.75 0 010 1.06z" clipRule="evenodd" />
            </svg>
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, items.length)} / {items.length}
          </span>
          <Button
            variant="ghost"
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
            disabled={(page + 1) * pageSize >= items.length}
            className="w-7 h-7 p-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </Button>
        </div>
      )}
    </div>
  );
}
