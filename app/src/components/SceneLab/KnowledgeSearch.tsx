import React, { useMemo, useState } from "react";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { useT } from "@/hooks/useT";

export function KnowledgeSearch({ nodes, busy, onSelect, onExplore }: {
  nodes: KnowledgeNode[];
  busy: boolean;
  onSelect: (node: KnowledgeNode) => void;
  onExplore: (query: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => normalized ? nodes.filter((node) => `${node.label} ${node.zh} ${node.note}`.toLocaleLowerCase().includes(normalized)).slice(0, 8) : [], [nodes, normalized]);

  const explore = () => {
    if (!normalized || busy) return;
    onExplore(query.trim());
    setQuery("");
  };

  return <div className="relative ml-3 w-full max-w-md">
    <div className="flex h-9 items-center rounded-xl border bg-background/80 px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
      <span className="mr-2 text-sm text-muted-foreground">⌕</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") matches[0] ? onSelect(matches[0]) : explore(); }} placeholder={t("knowledgeMap.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      {query && <button onClick={() => setQuery("")} className="text-xs text-muted-foreground">×</button>}
    </div>
    {normalized && <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl">
      {matches.map((node) => <button key={node.id} onClick={() => { onSelect(node); setQuery(""); }} className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,.8fr)_auto] items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted">
        <span className="truncate text-sm font-medium">{node.label}</span><span className="truncate text-xs text-muted-foreground">{node.zh}</span><span className="text-[9px] uppercase text-primary">{t(`knowledgeMap.kind.${node.kind}`)}</span>
      </button>)}
      <button onClick={explore} disabled={busy} className="mt-1 flex w-full items-center justify-between rounded-lg border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
        <span>{matches.length ? t("knowledgeMap.createAnyway") : t("knowledgeMap.createNoMatch")}</span><span className="max-w-48 truncate">“{query.trim()}” →</span>
      </button>
    </div>}
  </div>;
}
