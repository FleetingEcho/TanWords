import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { buildChildrenMap, getBreadcrumb } from "@/features/knowledge-map/tree";
import { useT } from "@/hooks/useT";
import { KnowledgeWordDetail } from "./KnowledgeWordDetail";
import type { ParsedEnrichment } from "@/lib/enrichMeta";

const isLearnable = (node: KnowledgeNode) => node.kind === "word" || node.kind === "phrase";

export function KnowledgeBoard({ nodes, current, checked, expanding, generating, onSelect, onToggle, onExpand, onPersistDetail, onAddWord }: {
  nodes: KnowledgeNode[];
  current: KnowledgeNode;
  checked: Set<number>;
  expanding: boolean;
  generating?: boolean;
  onSelect: (node: KnowledgeNode) => void;
  onToggle: (id: number) => void;
  onExpand: () => void;
  onPersistDetail: (node: KnowledgeNode, enrichment: ParsedEnrichment) => Promise<void>;
  onAddWord: (nodeId: number) => void;
}) {
  const t = useT();
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const children = childrenMap.get(current.id) ?? [];
  const breadcrumb = getBreadcrumb(nodes, current.id);
  const learnable = isLearnable(current);
  const available = children.filter((node) => isLearnable(node) && !node.word_id);
  const allSelected = available.length > 0 && available.every((node) => checked.has(node.id));
  const isRoot = current.parent_id === null;
  const previewWords = isRoot ? nodes.filter((node) => node.kind === "word").slice(0, 6) : [];
  const previewSentences = isRoot ? nodes.filter((node) => node.kind === "phrase").slice(0, 2) : [];

  if (current.kind === "word") return <main className="min-h-0 overflow-y-auto bg-background">
    <div className="mx-auto max-w-5xl p-8">
      <nav className="mb-6 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {breadcrumb.map((node, index) => <React.Fragment key={node.id}>{index > 0 && <span>/</span>}<button onClick={() => onSelect(node)} className="rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">{node.label}</button></React.Fragment>)}
      </nav>
      <KnowledgeWordDetail node={current} onPersist={onPersistDetail} onAdd={onAddWord} />
    </div>
  </main>;

  return <main className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/.06),transparent_35%)]">
    <div className="mx-auto max-w-5xl p-8">
      <nav className="mb-6 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {breadcrumb.map((node, index) => <React.Fragment key={node.id}>{index > 0 && <span>/</span>}<button onClick={() => onSelect(node)} className="rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">{node.label}</button></React.Fragment>)}
      </nav>

      <section className={`rounded-3xl border bg-card p-7 shadow-sm ${isRoot ? "bg-gradient-to-br from-primary/10 to-transparent" : ""}`}>
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">{t(`knowledgeMap.kind.${current.kind}`)}</span>
            <div className="mt-2 flex items-center gap-3"><h1 className="font-serif text-4xl font-bold">{current.label}</h1>{learnable && <SpeakButton text={current.label} className="h-5 w-5" />}</div>
            <p className="mt-2 text-lg text-muted-foreground">{current.zh || t("knowledgeMap.noTranslation")}</p>
            <div className="mt-4 flex items-center gap-2">{current.level && <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold">CEFR {current.level}</span>}{current.word_id && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-500">{t("knowledgeMap.inVocabulary")}</span>}</div>
          </div>
          {learnable && <Button variant={checked.has(current.id) ? "secondary" : "default"} disabled={Boolean(current.word_id)} onClick={() => onToggle(current.id)}>{current.word_id ? t("knowledgeMap.addedVocabulary") : checked.has(current.id) ? t("knowledgeMap.cancelSelection") : `+ ${t("knowledgeMap.addVocabulary")}`}</Button>}
        </div>
        {current.note && <div className="mt-6 rounded-2xl bg-muted/50 p-4 text-sm leading-7">
          {current.note}
          {(previewWords.length > 0 || previewSentences.length > 0) && <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
            {previewWords.length > 0 && <div className="flex flex-wrap gap-2">
              {previewWords.map((node) => <button key={node.id} onClick={() => onSelect(node)} className="rounded-full border bg-card px-3 py-1 text-xs font-medium transition hover:border-primary/50">
                {node.label}{node.zh && <span className="ml-1.5 font-normal text-muted-foreground">{node.zh}</span>}
              </button>)}
            </div>}
            {previewSentences.length > 0 && <div className="space-y-1.5">
              {previewSentences.map((node) => <button key={node.id} onClick={() => onSelect(node)} className="block w-full text-left transition hover:text-primary">
                “{node.label}”{node.zh && <span className="ml-1.5 text-muted-foreground">{node.zh}</span>}
              </button>)}
            </div>}
          </div>}
        </div>}
        {!current.note && isRoot && generating && <div className="mt-6 animate-pulse space-y-2 rounded-2xl bg-muted/50 p-4">
          <div className="h-3 w-11/12 rounded bg-muted-foreground/20" />
          <div className="h-3 w-4/5 rounded bg-muted-foreground/20" />
          <div className="h-3 w-2/3 rounded bg-muted-foreground/20" />
        </div>}
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="font-serif text-xl font-bold">{children.length ? t("knowledgeMap.related") : t("knowledgeMap.continueExplore")}</h2><p className="mt-1 text-xs text-muted-foreground">{children.length ? t("knowledgeMap.directItems", { count: children.length }) : t("knowledgeMap.noChildren")}</p></div>
          <div className="flex items-center gap-3">
            {!!available.length && <button className="text-xs font-medium text-primary" onClick={() => available.forEach((node) => { if (checked.has(node.id) === allSelected) onToggle(node.id); })}>{allSelected ? t("knowledgeMap.cancelAll") : t("knowledgeMap.selectAll")}</button>}
            <Button variant={learnable ? "outline" : "default"} size="sm" onClick={onExpand} disabled={expanding}>{expanding ? t("knowledgeMap.generating") : current.expanded ? t("knowledgeMap.generateMore") : t("knowledgeMap.expandTopic")}</Button>
          </div>
        </div>

        {children.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((node) => <article key={node.id} className="group relative rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
            <button onClick={() => onSelect(node)} className="block w-full text-left">
              <span className="text-[9px] font-bold uppercase tracking-widest text-primary">{t(`knowledgeMap.kind.${node.kind}`)}{node.level ? ` · ${node.level}` : ""}</span>
              <h3 className="mt-2 truncate font-serif text-xl font-bold">{node.label}</h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">{node.zh || t("knowledgeMap.noTranslation")}</p>
              {node.note && !isLearnable(node) && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{node.note}</p>}
            </button>
            {isLearnable(node) && <button disabled={Boolean(node.word_id)} onClick={() => onToggle(node.id)} className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-xs ${node.word_id ? "bg-emerald-500 text-white" : checked.has(node.id) ? "bg-primary text-primary-foreground" : "bg-background hover:border-primary"}`}>{node.word_id || checked.has(node.id) ? "✓" : "+"}</button>}
          </article>)}
        </div> : !isRoot && generating ? <div className="rounded-2xl border border-dashed p-8 text-center">
          <div className="mx-auto h-1 w-40 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-primary/40 to-primary" /></div>
          <p className="mt-3 text-sm text-muted-foreground">{t("knowledgeMap.generating")}</p>
        </div> : <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("knowledgeMap.emptyHint")}</div>}
      </section>
    </div>
  </main>;
}
