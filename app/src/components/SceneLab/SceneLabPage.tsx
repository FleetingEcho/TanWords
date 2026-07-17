import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { useDB } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import type { KnowledgeMapDetail, KnowledgeMapSummary, KnowledgeNode, KnowledgeNodeKind } from "@/features/knowledge-map/types";
import { BRANCH_PRESETS, expandNode, generateBranch, generateOverview, isSentenceBranchLabel, type RootType } from "@/features/knowledge-map/generator";
import { NODE_KIND_COLORS } from "@/features/knowledge-map/colors";
import { KnowledgeOutline } from "./KnowledgeOutline";
import { KnowledgeBoard } from "./KnowledgeBoard";
import { KnowledgeSearch } from "./KnowledgeSearch";
import { useT } from "@/hooks/useT";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { ParsedEnrichment } from "@/lib/enrichMeta";

const classifyRootType = (topic: string): RootType => {
  const situation = topic.length > 18 || topic.split(/\s+/).length >= 5 || /[。！？.!?]/.test(topic);
  if (situation) return "situation";
  const word = !/\s/.test(topic) && !/[，,]/.test(topic);
  return word ? "word" : "topic";
};

const EXAMPLE_TOPICS = ["kitchen", "job interview", "distributed systems", "bank"];

export default function SceneLabPage() {
  const db = useDB();
  const t = useT();
  const levels = useSettingsStore((state) => state.targetLevels.join("/"));
  const uiLanguage = useSettingsStore((state) => state.uiLanguage);
  const [input, setInput] = useState("");
  const [maps, setMaps] = useState<KnowledgeMapSummary[]>([]);
  const [map, setMap] = useState<KnowledgeMapDetail | null>(null);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeMapSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [addAllConfirmOpen, setAddAllConfirmOpen] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const cancelRef = useRef(false);

  const refreshList = useCallback(() => db.listKnowledgeMaps().then(setMaps), [db]);
  useEffect(() => { refreshList(); }, [refreshList]);

  const loadMap = async (id: number, preferredId?: number | null) => {
    const value = await db.getKnowledgeMap(id);
    if (!value) return null;
    const selectedId = preferredId === undefined ? selectedIdRef.current : preferredId;
    const nextSelected = value.nodes.find((node) => node.id === selectedId)
      ?? value.nodes.find((node) => node.parent_id === null)
      ?? value.nodes[0]
      ?? null;
    setMap(value);
    setSelected(nextSelected);
    selectedIdRef.current = nextSelected?.id ?? null;
    return value;
  };

  const create = async () => {
    const topic = input.trim();
    if (!topic || generating) return;
    const provider = findBestProvider();
    cancelRef.current = false;
    setGenerating(true);
    setProgress(0);
    let id: number | undefined;
    try {
      const rootType = classifyRootType(topic);
      const branches = BRANCH_PRESETS[rootType];
      id = await db.createKnowledgeMap(topic, rootType, levels);
      if (!id) return;
      const current = await db.getKnowledgeMap(id);
      const root = current?.nodes.find((node) => node.parent_id === null);
      if (!root) return;
      const categoryIds = await db.addKnowledgeNodes(id, root.id, branches);
      await loadMap(id, root.id);
      setProgress(10);
      if (!provider) {
        toast.info(t("knowledgeMap.mapSkeleton"));
        await refreshList();
        return;
      }
      const known = (await db.getWords()).map((word) => word.word);
      const overviewPromise = rootType === "word" ? generateOverview(provider, topic, levels).catch(() => "") : Promise.resolve("");
      let finished = 0;
      for (let start = 0; start < categoryIds.length && !cancelRef.current; start += 2) {
        await Promise.allSettled(categoryIds.slice(start, start + 2).map(async (categoryId, offset) => {
          const index = start + offset;
          const excluded = isSentenceBranchLabel(branches[index].label) ? [] : known;
          const nodes = await generateBranch(provider, topic, branches[index], levels, excluded);
          await db.addKnowledgeNodes(id!, categoryId, nodes);
          finished += 1;
          setProgress(Math.round(finished / categoryIds.length * 90 + 10));
        }));
        await loadMap(id);
      }
      const overview = cancelRef.current ? "" : await overviewPromise;
      if (overview) await db.updateKnowledgeNodeNote(root.id, overview);
      if (cancelRef.current) {
        await db.deleteKnowledgeMap(id);
        await refreshList();
        return;
      }
      await loadMap(id);
      await refreshList();
      toast.success(t("knowledgeMap.mapGenerated"));
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.createFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const cancelGeneration = () => {
    if (!generating || cancelRef.current) return;
    cancelRef.current = true;
    setGenerating(false);
    setMap(null);
    setSelected(null);
    selectedIdRef.current = null;
    toast.info(t("knowledgeMap.generationCancelled"));
  };

  const open = async (id: number) => {
    setChecked(new Set());
    let value = await loadMap(id);
    const branches = value ? BRANCH_PRESETS[value.root_type as RootType] : undefined;
    const sentenceBranch = branches?.find((branch) => isSentenceBranchLabel(branch.label));
    const root = value?.nodes.find((node) => node.parent_id === null);
    if (value && root && sentenceBranch && !value.nodes.some((node) => node.parent_id === root.id && node.label === sentenceBranch.label)) {
      await db.addKnowledgeNodes(id, root.id, [sentenceBranch]);
      value = await loadMap(id);
    }
    const branch = value?.nodes.find((node) => node.parent_id === root?.id && node.label === sentenceBranch?.label);
    const existing = branch ? value?.nodes.filter((node) => node.parent_id === branch.id) ?? [] : [];
    const provider = findBestProvider();
    if (value && branch && existing.length < 5 && provider) {
      setExpanding(true);
      try {
        const sentences = await generateBranch(provider, value.root_label, branch, levels, existing.map((node) => node.label));
        await db.addKnowledgeNodes(id, branch.id, sentences);
        await loadMap(id);
      } catch (error: any) {
        toast.error(error?.message || t("knowledgeMap.expandFailed"));
      } finally {
        setExpanding(false);
      }
    }
  };

  const removeMap = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const deleted = await db.deleteKnowledgeMap(deleteTarget.id);
    if (deleted) {
      toast.success(t("knowledgeMap.deleted"));
      setDeleteTarget(null);
      await refreshList();
    } else {
      toast.error(t("knowledgeMap.deleteFailed"));
    }
    setDeleting(false);
  };

  const expand = async (target = selected) => {
    if (!map || !target || expanding) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("knowledgeMap.configureAI"));
      return;
    }
    setExpanding(true);
    try {
      const excluded = target.label === "Common Situational Sentences"
        ? map.nodes.filter((node) => node.parent_id === target.id).map((node) => node.label)
        : map.nodes.map((node) => node.label);
      const nodes = await expandNode(provider, map.root_label, target, levels, excluded);
      if (!nodes.length) throw new Error(t("knowledgeMap.noModelItems"));
      await db.addKnowledgeNodes(map.id, target.id, nodes);
      await loadMap(map.id, target.id);
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.expandFailed"));
    } finally {
      setExpanding(false);
    }
  };

  const selectNode = (node: KnowledgeNode) => {
    selectedIdRef.current = node.id;
    setSelected(node);
  };

  const persistDetail = async (node: KnowledgeNode, enrichment: ParsedEnrichment) => {
    if (!map) return;
    await db.addWordEnriched(node.label, enrichment.zhShort || node.zh || node.label, null, {
      text: enrichment.text,
      zhShort: enrichment.zhShort || node.zh || undefined,
      level: enrichment.level || node.level || undefined,
    });
    await db.updateKnowledgeNodeNote(node.id, `__KNOWLEDGE_ENRICHED__\n${enrichment.text}`);
    await db.addMapWordsToVocabulary([node.id]);
    window.dispatchEvent(new CustomEvent("vocab-updated"));
    toast.success(t("knowledgeMap.analyzedAndAdded", { word: node.label }));
    await loadMap(map.id);
  };

  const explore = async (query: string) => {
    if (!map || !current || expanding) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("knowledgeMap.configureAI"));
      return;
    }
    setExpanding(true);
    try {
      const [id] = await db.addKnowledgeNodes(map.id, current.id, [{ kind: "topic", label: query, zh: "", level: "", note: t("knowledgeMap.branchNote", { parent: current.label }) }]);
      const fresh = await db.getKnowledgeMap(map.id);
      if (!fresh) throw new Error(t("knowledgeMap.readFailed"));
      const target = fresh.nodes.find((node) => node.id === id);
      if (!target) throw new Error(t("knowledgeMap.branchFailed"));
      setMap(fresh);
      selectedIdRef.current = target.id;
      setSelected(target);
      const generated = await expandNode(provider, map.root_label, target, levels, fresh.nodes.map((node) => node.label));
      if (!generated.length) throw new Error(t("knowledgeMap.noModelItems"));
      await db.addKnowledgeNodes(map.id, target.id, generated);
      await loadMap(map.id, target.id);
      toast.success(t("knowledgeMap.explored", { query }));
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.exploreFailed"));
    } finally {
      setExpanding(false);
    }
  };

  const toggle = (id: number) => setChecked((previous) => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const addAll = async () => {
    if (!map || addingAll) return;
    const nodeIds = map.nodes.filter((node) => (node.kind === "word" || node.kind === "phrase") && !node.word_id).map((node) => node.id);
    if (!nodeIds.length) return;
    setAddingAll(true);
    try {
      const result = await db.addMapWordsToVocabulary(nodeIds);
      if (result.added + result.linked) {
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("knowledgeMap.wordsAdded", { count: result.added + result.linked }));
        setChecked(new Set());
        setAddAllConfirmOpen(false);
        await loadMap(map.id);
      }
    } finally {
      setAddingAll(false);
    }
  };

  const addOne = async (id: number) => {
    const result = await db.addMapWordsToVocabulary([id]);
    if (result.added + result.linked) {
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(t("knowledgeMap.wordAdded"));
      if (map) await loadMap(map.id);
    }
  };

  if (!map) return <><div className="min-h-full bg-[radial-gradient(circle_at_1px_1px,hsl(var(--muted))_1px,transparent_0)] [background-size:22px_22px]">
    <div className="mx-auto max-w-5xl p-8">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Infinite Knowledge Map</p>
      <h1 className="mt-2 font-serif text-4xl font-bold">{t("knowledgeMap.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("knowledgeMap.subtitle")}</p>
      <div className="mt-7 flex gap-2">
        <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder={t("knowledgeMap.inputPlaceholder")} className="h-11 flex-1 rounded-xl border bg-background px-4 outline-none focus:ring-2 focus:ring-primary/40" />
        <Button onClick={create} disabled={generating || !input.trim()} className="h-11 px-6">{generating ? t("knowledgeMap.generatingProgress", { progress }) : t("knowledgeMap.generate")}</Button>
      </div>
      {generating && <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
        <button onClick={cancelGeneration} className="shrink-0 rounded-full border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/10">{t("knowledgeMap.cancelGeneration")}</button>
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("knowledgeMap.tryExamples")}</span>
        {EXAMPLE_TOPICS.map((example) => <button key={example} onClick={() => setInput(example)} className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground">{example}</button>)}
      </div>
      <h2 className="mb-3 mt-10 font-semibold">{t("knowledgeMap.myMaps")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{maps.map((item) => <article key={item.id} className="group relative overflow-hidden rounded-2xl border bg-card transition hover:border-primary/50">
        <div className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: NODE_KIND_COLORS[item.root_type as KnowledgeNodeKind] ?? NODE_KIND_COLORS.topic }} />
        <button onClick={() => open(item.id)} className="block w-full p-4 pl-5 pr-12 text-left">
          <strong>{item.root_label}</strong>
          <p className="mt-1 text-xs text-muted-foreground">{t(`knowledgeMap.kind.${item.root_type}`)} · {t("knowledgeMap.nodes", { count: item.node_count })} · {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true, locale: uiLanguage === "zh" ? zhCN : enUS })}</p>
        </button>
        <button onClick={() => setDeleteTarget(item)} aria-label={`${t("knowledgeMap.delete")}: ${item.root_label}`} title={t("knowledgeMap.delete")} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus:opacity-100">×</button>
      </article>)}</div>
    </div>
  </div><ConfirmModal
    open={Boolean(deleteTarget)}
    title={t("knowledgeMap.delete")}
    message={t("knowledgeMap.deleteConfirm", { name: deleteTarget?.root_label ?? "" })}
    confirmLabel={deleting ? t("knowledgeMap.deleting") : t("knowledgeMap.delete")}
    confirmDisabled={deleting}
    onConfirm={removeMap}
    onCancel={() => !deleting && setDeleteTarget(null)}
  /></>;

  const current = selected ?? map.nodes.find((node) => node.parent_id === null) ?? map.nodes[0];
  if (!current) return null;

  const addableCount = map.nodes.filter((node) => (node.kind === "word" || node.kind === "phrase") && !node.word_id).length;

  return <><div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button variant="ghost" onClick={() => { setMap(null); setSelected(null); selectedIdRef.current = null; refreshList(); }}>{t("knowledgeMap.back")}</Button>
      <span className="text-xs text-muted-foreground">{t("knowledgeMap.nodes", { count: map.nodes.length })}</span>
      {generating && <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />{t("knowledgeMap.generatingProgress", { progress })}
        <button onClick={cancelGeneration} className="ml-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary transition hover:bg-primary/10">{t("knowledgeMap.cancelGeneration")}</button>
      </span>}
      <KnowledgeSearch nodes={map.nodes} busy={expanding} onSelect={selectNode} onExplore={explore} />
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,32%)_minmax(0,1fr)]">
      <KnowledgeOutline nodes={map.nodes} selectedId={current.id} addableCount={addableCount} onSelect={selectNode} onAdd={addOne} onAddAll={() => setAddAllConfirmOpen(true)} />
      <KnowledgeBoard nodes={map.nodes} current={current} checked={checked} expanding={expanding} generating={generating} onSelect={selectNode} onToggle={toggle} onExpand={() => expand(current)} onPersistDetail={persistDetail} onAddWord={addOne} />
    </div>
  </div><ConfirmModal
    open={addAllConfirmOpen}
    title={t("knowledgeMap.addAllConfirmTitle")}
    message={t("knowledgeMap.addAllConfirmMessage", { count: addableCount })}
    confirmLabel={addingAll ? t("knowledgeMap.addingAll") : t("knowledgeMap.addAllVocabulary")}
    danger={false}
    confirmDisabled={addingAll || !addableCount}
    onConfirm={addAll}
    onCancel={() => !addingAll && setAddAllConfirmOpen(false)}
  /></>;
}
