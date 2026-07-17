import React, { useEffect, useMemo, useState } from "react";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { buildChildrenMap, getBreadcrumb } from "@/features/knowledge-map/tree";
import { NODE_KIND_COLORS } from "@/features/knowledge-map/colors";
import { useT } from "@/hooks/useT";

export function KnowledgeOutline({ nodes, selectedId, addableCount, onSelect, onAdd, onAddAll }: {
  nodes: KnowledgeNode[];
  selectedId: number;
  addableCount: number;
  onSelect: (node: KnowledgeNode) => void;
  onAdd: (id: number) => void;
  onAddAll: () => void;
}) {
  const t = useT();
  const children = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const roots = children.get(null) ?? [];
  const [open, setOpen] = useState<Set<number>>(() => new Set(roots.map((node) => node.id)));

  useEffect(() => {
    const path = getBreadcrumb(nodes, selectedId);
    setOpen((current) => new Set([...current, ...path.map((node) => node.id)]));
  }, [nodes, selectedId]);

  const renderNode = (node: KnowledgeNode) => {
    const descendants = children.get(node.id) ?? [];
    const isOpen = open.has(node.id);
    const active = node.id === selectedId;
    const learnable = node.kind === "word" || node.kind === "phrase";
    return <React.Fragment key={node.id}>
      <div className="flex items-center" style={{ paddingLeft: `${Math.min(node.depth, 12) * 12}px` }}>
        <button
          aria-label={isOpen ? t("knowledgeMap.collapse") : t("knowledgeMap.expand")}
          disabled={!descendants.length}
          onClick={() => setOpen((current) => {
            const next = new Set(current);
            next.has(node.id) ? next.delete(node.id) : next.add(node.id);
            return next;
          })}
          className="flex h-7 w-6 shrink-0 items-center justify-center text-xs text-muted-foreground disabled:opacity-20"
        >{descendants.length ? (isOpen ? "▾" : "▸") : "·"}</button>
        <button
          onClick={() => onSelect(node)}
          className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,.9fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}
        >
          <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NODE_KIND_COLORS[node.kind] }} /><span className="truncate">{node.label}</span></span>
          <span className="truncate text-xs font-normal text-muted-foreground">{node.zh}</span>
          {!!descendants.length && node.parent_id !== null && <span className="text-[10px] font-normal text-muted-foreground">{descendants.length}</span>}
        </button>
        {node.parent_id === null && <button onClick={onAddAll} disabled={!addableCount} title={t("knowledgeMap.addAllVocabulary")} aria-label={t("knowledgeMap.addAllVocabulary")} className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-sm text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-30">+</button>}
        {learnable && <button
          aria-label={node.word_id ? t("knowledgeMap.wordAddedAria", { word: node.label }) : t("knowledgeMap.addWordAria", { word: node.label })}
          title={node.word_id ? t("knowledgeMap.inVocabulary") : t("knowledgeMap.addNow")}
          disabled={Boolean(node.word_id)}
          onClick={() => onAdd(node.id)}
          className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs transition ${node.word_id ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" : "border-border bg-background text-muted-foreground hover:border-primary hover:text-primary"}`}
        >{node.word_id ? "✓" : "+"}</button>}
      </div>
      {isOpen && descendants.map(renderNode)}
    </React.Fragment>;
  };

  return <aside className="min-h-0 overflow-y-auto border-r bg-muted/15 p-3">
    <div className="mb-3 flex min-h-8 items-center px-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Outline</div>
    <div className="space-y-0.5">{roots.map(renderNode)}</div>
  </aside>;
}
