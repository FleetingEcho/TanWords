import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDB } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import type { KnowledgeMapDetail, KnowledgeMapSummary, KnowledgeNode } from "@/features/knowledge-map/types";
import { DEFAULT_BRANCHES, expandNode, generateBranch, generateExamples } from "@/features/knowledge-map/generator";
import { KnowledgeOutline } from "./KnowledgeOutline";
import { KnowledgeBoard } from "./KnowledgeBoard";
import { KnowledgeSearch } from "./KnowledgeSearch";
import { useT } from "@/hooks/useT";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

export default function SceneLabPage() {
  const db = useDB();
  const t = useT();
  const levels = useSettingsStore((state) => state.targetLevels.join("/"));
  const [input, setInput] = useState("");
  const [maps, setMaps] = useState<KnowledgeMapSummary[]>([]);
  const [map, setMap] = useState<KnowledgeMapDetail | null>(null);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const exampleJobsRef = useRef(new Set<number>());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeMapSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    setGenerating(true);
    setProgress(0);
    try {
      const rootType = topic.length > 18 || topic.trim().split(/\s+/).length >= 5 || /[。！？.!?]/.test(topic) ? "situation" : "topic";
      const id = await db.createKnowledgeMap(topic, rootType, levels);
      if (!id) return;
      const current = await db.getKnowledgeMap(id);
      const root = current?.nodes.find((node) => node.parent_id === null);
      if (!root) return;
      const categoryIds = await db.addKnowledgeNodes(id, root.id, DEFAULT_BRANCHES);
      await loadMap(id, root.id);
      setProgress(10);
      if (!provider) {
        toast.info(t("knowledgeMap.mapSkeleton"));
        await refreshList();
        return;
      }
      const known = (await db.getWords()).map((word) => word.word);
      let finished = 0;
      for (let start = 0; start < categoryIds.length; start += 2) {
        await Promise.allSettled(categoryIds.slice(start, start + 2).map(async (categoryId, offset) => {
          const index = start + offset;
          const excluded = DEFAULT_BRANCHES[index].label === "Common Situational Sentences" ? [] : known;
          const nodes = await generateBranch(provider, topic, DEFAULT_BRANCHES[index], levels, excluded);
          await db.addKnowledgeNodes(id, categoryId, nodes);
          finished += 1;
          setProgress(Math.round(finished / categoryIds.length * 90 + 10));
        }));
        await loadMap(id);
      }
      await refreshList();
      toast.success(t("knowledgeMap.mapGenerated"));
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.createFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const open = async (id: number) => {
    setChecked(new Set());
    let value = await loadMap(id);
    const sentenceBranch = DEFAULT_BRANCHES.find((branch) => branch.label === "Common Situational Sentences");
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
    if (node.kind !== "word" || node.note.split("||").filter(Boolean).length >= 2 || exampleJobsRef.current.has(node.id)) return;
    const provider = findBestProvider();
    if (!provider || !map) return;
    exampleJobsRef.current.add(node.id);
    void generateExamples(provider, map.root_label, node, levels).then(async (examples) => {
      if (examples.length < 2) return;
      const saved = await db.updateKnowledgeNodeNote(node.id, examples.join(" || "));
      if (saved) await loadMap(map.id);
    }).finally(() => exampleJobsRef.current.delete(node.id));
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

  const add = async () => {
    const result = await db.addMapWordsToVocabulary([...checked]);
    if (result.added + result.linked) {
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(t("knowledgeMap.wordsAdded", { count: result.added + result.linked }));
      setChecked(new Set());
      if (map) await loadMap(map.id);
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

  if (!map) return <><div className="mx-auto max-w-5xl p-8">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Infinite Knowledge Map</p>
    <h1 className="mt-2 font-serif text-4xl font-bold">{t("knowledgeMap.title")}</h1>
    <p className="mt-2 text-muted-foreground">{t("knowledgeMap.subtitle")}</p>
    <div className="mt-7 flex gap-2">
      <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder={t("knowledgeMap.inputPlaceholder")} className="h-11 flex-1 rounded-xl border bg-background px-4 outline-none focus:ring-2 focus:ring-primary/40" />
      <Button onClick={create} disabled={generating || !input.trim()} className="h-11 px-6">{generating ? t("knowledgeMap.generatingProgress", { progress }) : t("knowledgeMap.generate")}</Button>
    </div>
    {generating && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>}
    <h2 className="mb-3 mt-10 font-semibold">{t("knowledgeMap.myMaps")}</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{maps.map((item) => <article key={item.id} className="group relative rounded-2xl border bg-card transition hover:border-primary/50">
      <button onClick={() => open(item.id)} className="block w-full p-4 pr-12 text-left"><strong>{item.root_label}</strong><p className="mt-1 text-xs text-muted-foreground">{t("knowledgeMap.nodes", { count: item.node_count })} · {t(`knowledgeMap.kind.${item.root_type}`)}</p></button>
      <button onClick={() => setDeleteTarget(item)} aria-label={`${t("knowledgeMap.delete")}: ${item.root_label}`} title={t("knowledgeMap.delete")} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus:opacity-100">×</button>
    </article>)}</div>
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

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button variant="ghost" onClick={() => { setMap(null); setSelected(null); selectedIdRef.current = null; refreshList(); }}>{t("knowledgeMap.back")}</Button>
      <strong title={map.root_label} className="block max-w-56 shrink truncate font-serif text-lg leading-tight">{map.root_label}</strong>
      <span className="text-xs text-muted-foreground">{t("knowledgeMap.nodes", { count: map.nodes.length })}</span>
      <KnowledgeSearch nodes={map.nodes} busy={expanding} onSelect={selectNode} onExplore={explore} />
      <div className="ml-auto flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("knowledgeMap.selected", { count: checked.size })}</span><Button onClick={add} disabled={!checked.size} className="h-8 text-xs">{t("knowledgeMap.addVocabulary")}</Button></div>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,32%)_minmax(0,1fr)]">
      <KnowledgeOutline nodes={map.nodes} selectedId={current.id} onSelect={selectNode} onAdd={addOne} />
      <KnowledgeBoard nodes={map.nodes} current={current} checked={checked} expanding={expanding} onSelect={selectNode} onToggle={toggle} onExpand={() => expand(current)} />
    </div>
  </div>;
}
