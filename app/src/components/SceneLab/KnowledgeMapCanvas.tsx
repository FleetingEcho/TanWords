import React, { useMemo, useRef, useState } from "react";
import type { KnowledgeMapDetail, KnowledgeNode } from "@/features/knowledge-map/types";
import { radialLayout } from "@/features/knowledge-map/layout";

const COLORS: Record<string, string> = { topic: "#f59e0b", category: "#14b8a6", word: "#3b82f6", phrase: "#8b5cf6", situation: "#ec4899", contrast: "#ef4444" };

export function KnowledgeMapCanvas({ map, selectedId, checked, onSelect, onToggle }: { map: KnowledgeMapDetail; selectedId: number | null; checked: Set<number>; onSelect: (node: KnowledgeNode) => void; onToggle: (id: number) => void }) {
  const positions = useMemo(() => radialLayout(map), [map]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const world = (id: number) => positions.get(id) ?? { x: 0, y: 0 };

  return <div
    className="relative h-full min-h-[520px] overflow-hidden bg-[radial-gradient(circle_at_center,hsl(var(--muted))_1px,transparent_1px)] [background-size:24px_24px]"
    onWheel={(event) => { event.preventDefault(); setView((value) => ({ ...value, scale: Math.min(1.8, Math.max(.35, value.scale * (event.deltaY > 0 ? .9 : 1.1))) })); }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; }}
    onPointerMove={(event) => { if (drag.current) setView((value) => ({ ...value, x: drag.current!.vx + event.clientX - drag.current!.x, y: drag.current!.vy + event.clientY - drag.current!.y })); }}
    onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
  >
    <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
      <svg className="pointer-events-none absolute overflow-visible" width="1" height="1">{map.edges.map((edge, index) => { const source = world(edge.source_id); const target = world(edge.target_id); return <line key={index} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="hsl(var(--border))" strokeWidth={2 / view.scale} opacity=".75" />; })}</svg>
      {map.nodes.map((node) => {
        const point = world(node.id); const root = node.parent_id === null; const active = selectedId === node.id;
        return <button key={node.id} onClick={(event) => { event.stopPropagation(); onSelect(node); }} className={`group absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card px-3 py-2 text-left shadow-sm transition hover:z-20 hover:scale-110 hover:shadow-lg ${root ? "min-w-36" : "min-w-24 max-w-40"} ${active ? "ring-2 ring-primary ring-offset-2" : ""}`} style={{ left: point.x, top: point.y, borderColor: COLORS[node.kind] }}>
          <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider" style={{ color: COLORS[node.kind] }}>{node.kind}</span>
          <strong className={root ? "text-base" : "text-xs"}>{node.label}</strong>
          {node.zh && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{node.zh}</span>}
          {(node.kind === "word" || node.kind === "phrase") && <span onClick={(event) => { event.stopPropagation(); onToggle(node.id); }} className={`absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${node.word_id ? "bg-emerald-500 text-white" : checked.has(node.id) ? "bg-primary text-white" : "bg-card"}`}>{node.word_id ? "✓" : checked.has(node.id) ? "✓" : "+"}</span>}
          {node.expanded && <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-emerald-400" />}
        </button>;
      })}
    </div>
    <div className="absolute bottom-3 left-3 rounded-lg border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground">滚轮缩放 · 拖动地图 · 点击节点展开</div>
    <button onClick={() => setView({ x: 0, y: 0, scale: 1 })} className="absolute bottom-3 right-3 rounded-lg border bg-card px-3 py-1 text-xs">重置视图</button>
  </div>;
}
