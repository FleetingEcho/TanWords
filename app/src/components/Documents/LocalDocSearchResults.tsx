import React from "react";
import { LocalDocSearchResult } from "@/lib/localDocs";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (needle && index >= 0) {
    parts.push(text.slice(cursor, index));
    parts.push(<mark key={index} className="rounded-sm bg-yellow-300/70 px-0.5 text-inherit dark:bg-yellow-500/40">{text.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function HighlightFuzzy({ text, query }: { text: string; query: string }) {
  const chars = [...text];
  const needle = [...query.trim().toLowerCase()];
  const matched = new Set<number>();
  let cursor = 0;
  for (const target of needle) {
    const index = chars.findIndex((char, i) => i >= cursor && char.toLowerCase() === target);
    if (index < 0) return <>{text}</>;
    matched.add(index);
    cursor = index + 1;
  }
  return <>{chars.map((char, index) => matched.has(index)
    ? <mark key={index} className="rounded-sm bg-yellow-300/70 text-inherit dark:bg-yellow-500/40">{char}</mark>
    : char)}</>;
}

interface Props {
  results: LocalDocSearchResult[];
  query: string;
  activePath: string | null;
  onOpen: (path: string) => void;
}

export function LocalDocSearchResults({ results, query, activePath, onOpen }: Props) {
  return <div className="space-y-1.5">
    {results.map((result) => (
      <Button
        key={result.rel_path}
        type="button"
        variant="ghost"
        onClick={() => onOpen(result.rel_path)}
        className={`h-auto w-full items-start justify-start gap-2 px-2 py-2 text-left ${activePath === result.rel_path ? "bg-primary/10" : ""}`}
      >
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium"><HighlightFuzzy text={result.name.replace(/\.(md|markdown)$/i, "")} query={query} /></span>
          <span className="block truncate text-[10px] font-normal text-muted-foreground"><HighlightFuzzy text={result.rel_path} query={query} /></span>
          {result.hits.map((hit) => (
            <span key={`${hit.line_number}-${hit.line_text}`} className="mt-1 block line-clamp-2 whitespace-normal text-[11px] font-normal leading-4 text-muted-foreground">
              <span className="mr-1 font-mono opacity-50">{hit.line_number}</span>
              <HighlightMatch text={hit.line_text} query={query} />
            </span>
          ))}
        </span>
      </Button>
    ))}
  </div>;
}
