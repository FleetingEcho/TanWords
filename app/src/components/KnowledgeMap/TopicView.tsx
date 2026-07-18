import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { PATTERN_SAVED_PREFIX, type KnowledgeMapDetail, type KnowledgeNode } from "@/features/knowledge-map/types";
import { classifyInput } from "@/features/knowledge-map/generator";
import { useT } from "@/hooks/useT";

const isLearnable = (node: KnowledgeNode) => node.kind === "word" || node.kind === "phrase";
/** Full sentences and "A vs B" contrast entries have no dictionary detail. */
export const hasDetail = (node: KnowledgeNode) =>
  isLearnable(node) && !/\bvs\.?\b/i.test(node.label) && classifyInput(node.label) !== "sentence";
/** Full sentences go to the pattern library instead of the vocabulary. */
export const isSentence = (node: KnowledgeNode) =>
  isLearnable(node) && classifyInput(node.label) === "sentence";

function ItemRow({ node, checked, onToggle, onOpenDetail, onAddOne, onSavePattern }: {
  node: KnowledgeNode;
  checked: boolean;
  onToggle: (id: number) => void;
  onOpenDetail: (node: KnowledgeNode) => void;
  onAddOne: (id: number) => void;
  onSavePattern: (node: KnowledgeNode) => void;
}) {
  const t = useT();
  const added = Boolean(node.word_id);
  const addable = hasDetail(node);
  const patternSaved = node.note.startsWith(PATTERN_SAVED_PREFIX);
  const displayNote = patternSaved ? node.note.slice(PATTERN_SAVED_PREFIX.length) : node.note;
  return <div className={`group flex items-center gap-3 rounded-xl border px-3 py-2 transition hover:border-primary/40 hover:shadow-sm ${checked ? "border-primary/50 bg-primary/5" : "bg-card"}`}>
    {addable && <input
      type="checkbox"
      aria-label={t("knowledgeMap.selectItem", { word: node.label })}
      checked={checked}
      disabled={added}
      onChange={() => onToggle(node.id)}
      className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-30"
    />}
    <button
      onClick={() => hasDetail(node) && onOpenDetail(node)}
      className={`min-w-0 flex-1 text-left ${hasDetail(node) ? "" : "cursor-default"}`}
      tabIndex={hasDetail(node) ? 0 : -1}
    >
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <strong className="min-w-0 break-words font-serif text-[15px]">{node.label}</strong>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{node.zh}</span>
      </span>
      {displayNote && !displayNote.startsWith("__") && <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{displayNote}</span>}
    </button>
    {node.level && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{node.level}</span>}
    <SpeakButton text={node.label} className="h-4 w-4 shrink-0" />
    {addable && <button
      disabled={added}
      onClick={() => onAddOne(node.id)}
      title={added ? t("knowledgeMap.inVocabulary") : t("knowledgeMap.addNow")}
      aria-label={added ? t("knowledgeMap.wordAddedAria", { word: node.label }) : t("knowledgeMap.addWordAria", { word: node.label })}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition ${added ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" : "border-border bg-background text-muted-foreground opacity-0 hover:border-primary hover:text-primary group-hover:opacity-100"}`}
    >{added ? "✓" : "+"}</button>}
    {isSentence(node) && <button
      disabled={patternSaved}
      onClick={() => onSavePattern(node)}
      title={patternSaved ? t("knowledgeMap.patternSaved") : t("knowledgeMap.savePattern")}
      aria-label={patternSaved ? t("knowledgeMap.patternSaved") : t("knowledgeMap.savePattern")}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition ${patternSaved ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" : "border-border bg-background text-muted-foreground opacity-0 hover:border-primary hover:text-primary group-hover:opacity-100"}`}
    >{patternSaved ? "✓" : "+"}</button>}
  </div>;
}

export function TopicView({ map, checked, generating, busySectionId, digging, suggestions, onToggle, onOpenDetail, onAddOne, onSavePattern, onSelectSection, onMore, onDig, onAddAll }: {
  map: KnowledgeMapDetail;
  checked: Set<number>;
  generating: boolean;
  busySectionId: number | null;
  digging: boolean;
  suggestions: Array<[string, string]>;
  onToggle: (id: number) => void;
  onOpenDetail: (node: KnowledgeNode) => void;
  onAddOne: (id: number) => void;
  onSavePattern: (node: KnowledgeNode) => void;
  onSelectSection: (ids: number[], select: boolean) => void;
  onMore: (category: KnowledgeNode) => void;
  onDig: (label: string) => void;
  onAddAll: () => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [custom, setCustom] = useState("");

  const root = useMemo(() => map.nodes.find((node) => node.parent_id === null), [map.nodes]);
  const sections = useMemo(() => {
    if (!root) return [];
    return map.nodes
      .filter((node) => node.parent_id === root.id)
      .map((category) => ({ category, items: map.nodes.filter((node) => node.parent_id === category.id) }));
  }, [map.nodes, root]);
  const addableCount = useMemo(() => map.nodes.filter((node) => hasDetail(node) && !node.word_id).length, [map.nodes]);

  if (!root) return null;

  return <div className="mx-auto max-w-3xl px-6 py-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-serif text-3xl font-bold">{root.label}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {map.target_levels && <span className="mr-2 rounded-full bg-muted px-2 py-0.5 font-bold">CEFR {map.target_levels}</span>}
          {t("knowledgeMap.itemCount", { count: map.nodes.filter(isLearnable).length })}
        </p>
      </div>
      <Button variant="outline" size="sm" disabled={!addableCount || generating} onClick={onAddAll}>{t("knowledgeMap.addAllVocabulary")}</Button>
    </header>

    <div className="mt-6 space-y-6">
      {sections.map(({ category, items }) => {
        const isCollapsed = collapsed.has(category.id);
        const selectable = items.filter((node) => hasDetail(node) && !node.word_id);
        const allSelected = selectable.length > 0 && selectable.every((node) => checked.has(node.id));
        const busy = busySectionId === category.id;
        return <section key={category.id}>
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => setCollapsed((current) => { const next = new Set(current); next.has(category.id) ? next.delete(category.id) : next.add(category.id); return next; })}
              className="flex items-center gap-1.5 text-sm font-bold"
            >
              <span className="text-xs text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
              {category.zh || category.label}
              <span className="font-normal text-muted-foreground">({items.length})</span>
            </button>
            <div className="ml-auto flex items-center gap-3">
              {!!selectable.length && !isCollapsed && <button className="text-xs font-medium text-primary" onClick={() => onSelectSection(selectable.map((node) => node.id), !allSelected)}>{allSelected ? t("knowledgeMap.cancelAll") : t("knowledgeMap.selectSection")}</button>}
              <button disabled={busy || generating} onClick={() => onMore(category)} className="text-xs text-muted-foreground transition hover:text-primary disabled:opacity-40">{busy ? t("knowledgeMap.generating") : t("knowledgeMap.moreItems")}</button>
            </div>
          </div>
          {!isCollapsed && (items.length
            ? <div className="space-y-1.5">{items.map((node) => <ItemRow key={node.id} node={node} checked={checked.has(node.id)} onToggle={onToggle} onOpenDetail={onOpenDetail} onAddOne={onAddOne} onSavePattern={onSavePattern} />)}</div>
            : <div className={`rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground ${generating || busy ? "animate-pulse" : ""}`}>{generating || busy ? t("knowledgeMap.generating") : t("knowledgeMap.sectionEmpty")}</div>)}
        </section>;
      })}
    </div>

    <div className="mt-8 rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
      <p className="text-sm font-bold">✨ {t("knowledgeMap.digDeeper")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggestions.map(([label, zh]) => <button key={label} disabled={digging || generating} onClick={() => onDig(label)} className="rounded-full border bg-card px-3 py-1 text-xs transition hover:border-primary/50 hover:text-primary disabled:opacity-40">
          {label}{zh && <span className="ml-1 text-muted-foreground">{zh}</span>}
        </button>)}
        <div className="flex items-center gap-1.5">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && custom.trim() && !digging) { onDig(custom.trim()); setCustom(""); } }}
            placeholder={t("knowledgeMap.digCustomPlaceholder")}
            className="h-7 w-40 rounded-full border bg-background px-3 text-xs outline-none focus:border-primary/50"
          />
          <button disabled={digging || generating || !custom.trim()} onClick={() => { onDig(custom.trim()); setCustom(""); }} className="text-xs font-medium text-primary disabled:opacity-40">{digging ? t("knowledgeMap.generating") : t("knowledgeMap.digGo")}</button>
        </div>
      </div>
    </div>
  </div>;
}
