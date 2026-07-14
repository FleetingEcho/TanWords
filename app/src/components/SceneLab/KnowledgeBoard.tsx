import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { buildChildrenMap, getBreadcrumb } from "@/features/knowledge-map/tree";

const isLearnable = (node: KnowledgeNode) => node.kind === "word" || node.kind === "phrase";

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
  const learnable = isLearnable(current);
  const available = children.filter((node) => isLearnable(node) && !node.word_id);
  const allSelected = available.length > 0 && available.every((node) => checked.has(node.id));

  return <main className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/.06),transparent_35%)]">
    <div className="mx-auto max-w-5xl p-8">
      <nav className="mb-6 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {breadcrumb.map((node, index) => <React.Fragment key={node.id}>{index > 0 && <span>/</span>}<button onClick={() => onSelect(node)} className="rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">{node.label}</button></React.Fragment>)}
      </nav>

      <section className="rounded-3xl border bg-card p-7 shadow-sm">
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">{current.kind}</span>
            <div className="mt-2 flex items-center gap-3"><h1 className="font-serif text-4xl font-bold">{current.label}</h1>{learnable && <SpeakButton text={current.label} className="h-5 w-5" />}</div>
            <p className="mt-2 text-lg text-muted-foreground">{current.zh || "暂无中文释义"}</p>
            <div className="mt-4 flex items-center gap-2">{current.level && <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold">CEFR {current.level}</span>}{current.word_id && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-500">已在 Vocabulary</span>}</div>
          </div>
          {learnable && <Button variant={checked.has(current.id) ? "secondary" : "default"} disabled={Boolean(current.word_id)} onClick={() => onToggle(current.id)}>{current.word_id ? "已加入词库" : checked.has(current.id) ? "取消选择" : "+ 加入 Vocabulary"}</Button>}
        </div>
        {current.note && <div className="mt-6 rounded-2xl bg-muted/50 p-4 text-sm leading-7">{current.note}</div>}
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="font-serif text-xl font-bold">{children.length ? "相关内容" : "继续探索"}</h2><p className="mt-1 text-xs text-muted-foreground">{children.length ? `${children.length} 个直属条目` : "这个节点还没有下一级内容"}</p></div>
          <div className="flex items-center gap-3">
            {!!available.length && <button className="text-xs font-medium text-primary" onClick={() => available.forEach((node) => { if (checked.has(node.id) === allSelected) onToggle(node.id); })}>{allSelected ? "取消全选" : "全选词汇"}</button>}
            <Button variant={learnable ? "outline" : "default"} size="sm" onClick={onExpand} disabled={expanding}>{expanding ? "生成中…" : current.expanded ? "+ 生成更多" : "+ 展开这个主题"}</Button>
          </div>
        </div>

        {children.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((node) => <article key={node.id} className="group relative rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
            <button onClick={() => onSelect(node)} className="block w-full text-left">
              <span className="text-[9px] font-bold uppercase tracking-widest text-primary">{node.kind}{node.level ? ` · ${node.level}` : ""}</span>
              <h3 className="mt-2 truncate font-serif text-xl font-bold">{node.label}</h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">{node.zh || "暂无中文释义"}</p>
              {node.note && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{node.note}</p>}
            </button>
            {isLearnable(node) && <button disabled={Boolean(node.word_id)} onClick={() => onToggle(node.id)} className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-xs ${node.word_id ? "bg-emerald-500 text-white" : checked.has(node.id) ? "bg-primary text-primary-foreground" : "bg-background hover:border-primary"}`}>{node.word_id || checked.has(node.id) ? "✓" : "+"}</button>}
          </article>)}
        </div> : <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">需要更多关联词时，再点击“展开这个主题”。生成不是学习界面的主角。</div>}
      </section>
    </div>
  </main>;
}
