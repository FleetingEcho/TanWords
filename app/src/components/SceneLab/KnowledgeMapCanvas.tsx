import React, { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeMapDetail, KnowledgeNode } from "@/features/knowledge-map/types";
import { radialLayout } from "@/features/knowledge-map/layout";
import { NODE_KIND_COLORS as COLORS } from "@/features/knowledge-map/colors";

export function KnowledgeMapCanvas({ map, selectedId, checked, onSelect, onToggle }: { map: KnowledgeMapDetail; selectedId: number | null; checked: Set<number>; onSelect: (node: KnowledgeNode) => void; onToggle: (id: number) => void }) {
  const positions = useMemo(() => radialLayout(map), [map]);
  const [view, setView] = useState({ x: 0, y: 0, scale: .72 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const nodeDrag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const suppressClick = useRef(false);
  const storageKey = `tanwords_map_positions_${map.id}`;
  const [overrides, setOverrides] = useState<Record<number, { x: number; y: number }>>({});
  const overridesRef = useRef<Record<number, { x: number; y: number }>>({});
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); overridesRef.current = saved; setOverrides(saved); }
    catch { overridesRef.current = {}; setOverrides({}); }
  }, [storageKey]);
  const world = (id: number) => overrides[id] ?? positions.get(id) ?? { x: 0, y: 0 };
  const persistPositions = (next: Record<number, { x: number; y: number }>) => {
    overridesRef.current = next;
    setOverrides(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return <div
    className="relative h-full min-h-[520px] overflow-hidden bg-[radial-gradient(circle_at_center,hsl(var(--muted))_1px,transparent_1px)] [background-size:24px_24px]"
    onWheel={(event) => { event.preventDefault(); setView((value) => ({ ...value, scale: Math.min(1.8, Math.max(.35, value.scale * (event.deltaY > 0 ? .9 : 1.1))) })); }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; }}
    onPointerMove={(event) => {
      if (nodeDrag.current) {
        const movedX = (event.clientX - nodeDrag.current.startX) / view.scale;
        const movedY = (event.clientY - nodeDrag.current.startY) / view.scale;
        if (Math.abs(movedX) + Math.abs(movedY) > 3) suppressClick.current = true;
        setOverrides((current) => { const next = { ...current, [nodeDrag.current!.id]: { x: nodeDrag.current!.x + movedX, y: nodeDrag.current!.y + movedY } }; overridesRef.current = next; return next; });
      } else if (drag.current) {
        setView((value) => ({ ...value, x: drag.current!.vx + event.clientX - drag.current!.x, y: drag.current!.vy + event.clientY - drag.current!.y }));
      }
    }}
    onPointerUp={() => { if (nodeDrag.current) persistPositions(overridesRef.current); nodeDrag.current = null; drag.current = null; }}
    onPointerLeave={() => { nodeDrag.current = null; drag.current = null; }}
  >
    <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
      <svg className="pointer-events-none absolute overflow-visible" width="1" height="1">{map.edges.map((edge, index) => { const source = world(edge.source_id); const target = world(edge.target_id); return <line key={index} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="hsl(var(--border))" strokeWidth={2 / view.scale} opacity=".75" />; })}</svg>
      {map.nodes.map((node) => {
        const point = world(node.id); const root = node.parent_id === null; const active = selectedId === node.id;
        return <button key={node.id}
          onPointerDown={(event) => { event.stopPropagation(); const current = world(node.id); nodeDrag.current = { id: node.id, x: current.x, y: current.y, startX: event.clientX, startY: event.clientY }; suppressClick.current = false; }}
          onClick={(event) => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } onSelect(node); }}
          className={`group absolute -translate-x-1/2 -translate-y-1/2 cursor-grab select-none rounded-xl border bg-card px-2.5 py-2 text-left shadow-sm transition active:cursor-grabbing hover:z-20 hover:shadow-lg ${root ? "min-w-32" : "w-28"} ${active ? "ring-2 ring-primary ring-offset-2" : ""}`} style={{ left: point.x, top: point.y, borderColor: COLORS[node.kind] }}>
          <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider" style={{ color: COLORS[node.kind] }}>{node.kind}</span>
          <strong className={root ? "text-base" : "text-xs"}>{node.label}</strong>
          {node.zh && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{node.zh}</span>}
          {(node.kind === "word" || node.kind === "phrase") && <span onClick={(event) => { event.stopPropagation(); onToggle(node.id); }} className={`absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${node.word_id ? "bg-emerald-500 text-white" : checked.has(node.id) ? "bg-primary text-white" : "bg-card"}`}>{node.word_id ? "✓" : checked.has(node.id) ? "✓" : "+"}</span>}
          {node.expanded && <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-emerald-400" />}
        </button>;
      })}
    </div>
    <div className="absolute bottom-3 left-3 rounded-lg border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground">滚轮缩放 · 拖动空白移动地图 · 拖动节点调整位置</div>
    <button onClick={() => { setView({ x: 0, y: 0, scale: .72 }); persistPositions({}); }} className="absolute bottom-3 right-3 rounded-lg border bg-card px-3 py-1 text-xs">自动整理</button>
  </div>;
}
