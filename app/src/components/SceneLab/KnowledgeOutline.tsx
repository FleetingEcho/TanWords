import React, { useEffect, useMemo, useState } from "react";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { buildChildrenMap, getBreadcrumb } from "@/features/knowledge-map/tree";

const DOT: Record<string, string> = {
  topic: "bg-amber-500", category: "bg-teal-500", word: "bg-blue-500",
  phrase: "bg-violet-500", situation: "bg-pink-500", contrast: "bg-red-500",
};

export function KnowledgeOutline({ nodes, selectedId, onSelect }: {
  nodes: KnowledgeNode[];
  selectedId: number;
  onSelect: (node: KnowledgeNode) => void;
}) {
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
    return <React.Fragment key={node.id}>
      <div className="flex items-center" style={{ paddingLeft: `${Math.min(node.depth, 12) * 12}px` }}>
        <button
          aria-label={isOpen ? "折叠" : "展开"}
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
          <span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${DOT[node.kind]}`} /><span className="truncate">{node.label}</span></span>
          <span className="truncate text-xs font-normal text-muted-foreground">{node.zh}</span>
          {!!descendants.length && <span className="text-[10px] font-normal text-muted-foreground">{descendants.length}</span>}
        </button>
      </div>
      {isOpen && descendants.map(renderNode)}
    </React.Fragment>;
  };

  return <aside className="min-h-0 overflow-y-auto border-r bg-muted/15 p-3">
    <div className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Outline</div>
    <div className="space-y-0.5">{roots.map(renderNode)}</div>
  </aside>;
}
