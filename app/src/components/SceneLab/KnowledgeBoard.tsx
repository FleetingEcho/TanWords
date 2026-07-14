import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { buildChildrenMap, getBreadcrumb } from "@/features/knowledge-map/tree";

const learnable = (node: KnowledgeNode) => node.kind === "word" || node.kind === "phrase";

export function KnowledgeBoard({ nodes, current, checked, expanding, onSelect, onToggle, onExpand }: {
  nodes: KnowledgeNode[];
  current: KnowledgeNode;
  checked: Set<number>;
  expanding: boolean;
  onSelect: (node: KnowledgeNode) => void;
  onToggle: (id: number) => void;
  onExpand: () => void;
}) {
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const children = childrenMap.get(current.id) ?? [];
  const breadcrumb = getBreadcrumb(nodes, current.id);
  const available = children.filter((node) => learnable(node) && !node.word_id);
  const allSelected = available.length > 0 && available.every((node) => checked.has(node.id));

  return <main className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/.06),transparent_35%)] p-6">
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {breadcrumb.map((node, index) => <React.Fragment key={node.id}>
        {index > 0 && <span>/</span>}
        <button onClick={() => onSelect(node)} className="rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">{node.label}</button>
      </React.Fragment>)}
    </nav>
    <div className="mb-6 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Current branch</div>
        <h1 className="mt-1 truncate font-serif text-3xl font-bold">{current.label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{current.zh || current.note || "选择卡片进入下一层，任何节点都可以继续生成。"}</p>
      </div>
      <Button onClick={onExpand} disabled={expanding}>{expanding ? "生成中…" : current.expanded ? "继续生成" : "生成子节点"}</Button>
    </div>
    {!!available.length && <div className="mb-3 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">直属子项 {children.length} 个</span>
      <button className="text-xs font-medium text-primary" onClick={() => available.forEach((node) => { if (checked.has(node.id) === allSelected) onToggle(node.id); })}>{allSelected ? "取消全选" : "全选可学习词汇"}</button>
    </div>}
    {children.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {children.map((node) => <article key={node.id} className="group relative rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        <button onClick={() => onSelect(node)} className="block w-full text-left">
          <span className="text-[9px] font-bold uppercase tracking-widest text-primary">{node.kind}{node.level ? ` · ${node.level}` : ""}</span>
          <h2 className="mt-2 truncate font-serif text-xl font-bold">{node.label}</h2>
          <p className="mt-1 min-h-10 text-sm text-muted-foreground">{node.zh || "暂无中文释义"}</p>
          {node.note && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{node.note}</p>}
          <div className="mt-4 text-xs font-medium text-primary">打开分支 →</div>
        </button>
        {learnable(node) && <button
          disabled={Boolean(node.word_id)}
          onClick={() => onToggle(node.id)}
          className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-xs ${node.word_id ? "bg-emerald-500 text-white" : checked.has(node.id) ? "bg-primary text-primary-foreground" : "bg-background hover:border-primary"}`}
          title={node.word_id ? "已在 Vocabulary" : "选择加入 Vocabulary"}
        >{node.word_id || checked.has(node.id) ? "✓" : "+"}</button>}
      </article>)}
    </div> : <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed bg-card/50 p-8 text-center">
      <div className="text-3xl">↳</div>
      <h2 className="mt-3 font-serif text-xl font-bold">这个分支还没有内容</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">只生成当前层的一小批内容，本地小模型也能稳定完成。</p>
      <Button onClick={onExpand} disabled={expanding} className="mt-5">{expanding ? "生成中…" : "生成第一批子节点"}</Button>
    </div>}
  </main>;
}
