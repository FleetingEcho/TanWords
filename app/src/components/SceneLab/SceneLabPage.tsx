import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDB } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import type { KnowledgeMapDetail, KnowledgeMapSummary, KnowledgeNode } from "@/features/knowledge-map/types";
import { DEFAULT_BRANCHES, expandNode, generateBranch } from "@/features/knowledge-map/generator";
import { KnowledgeOutline } from "./KnowledgeOutline";
import { KnowledgeBoard } from "./KnowledgeBoard";
import { KnowledgeSearch } from "./KnowledgeSearch";

export default function SceneLabPage() {
  const db = useDB();
  const levels = useSettingsStore((state) => state.targetLevels.join("/"));
  const [input, setInput] = useState("");
  const [maps, setMaps] = useState<KnowledgeMapSummary[]>([]);
  const [map, setMap] = useState<KnowledgeMapDetail | null>(null);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanding, setExpanding] = useState(false);

  const refreshList = useCallback(() => db.listKnowledgeMaps().then(setMaps), [db]);
  useEffect(() => { refreshList(); }, [refreshList]);

  const loadMap = async (id: number, preferredId?: number) => {
    const value = await db.getKnowledgeMap(id);
    if (!value) return null;
    const nextSelected = value.nodes.find((node) => node.id === preferredId)
      ?? value.nodes.find((node) => node.parent_id === null)
      ?? value.nodes[0]
      ?? null;
    setMap(value);
    setSelected(nextSelected);
    return value;
  };

  const create = async () => {
    const topic = input.trim();
    if (!topic || generating) return;
    const provider = findBestProvider();
    setGenerating(true);
    setProgress(0);
    try {
      const id = await db.createKnowledgeMap(topic, "topic", levels);
      if (!id) return;
      const current = await db.getKnowledgeMap(id);
      const root = current?.nodes.find((node) => node.parent_id === null);
      if (!root) return;
      const categoryIds = await db.addKnowledgeNodes(id, root.id, DEFAULT_BRANCHES);
      await loadMap(id, root.id);
      setProgress(10);
      if (!provider) {
        toast.info("已创建地图骨架；配置 AI 后可逐个展开");
        await refreshList();
        return;
      }
      const known = (await db.getWords()).map((word) => word.word);
      let finished = 0;
      for (let start = 0; start < categoryIds.length; start += 2) {
        await Promise.allSettled(categoryIds.slice(start, start + 2).map(async (categoryId, offset) => {
          const index = start + offset;
          const nodes = await generateBranch(provider, topic, DEFAULT_BRANCHES[index], levels, known);
          await db.addKnowledgeNodes(id, categoryId, nodes);
          finished += 1;
          setProgress(Math.round(finished / categoryIds.length * 90 + 10));
        }));
        await loadMap(id, root.id);
      }
      await refreshList();
      toast.success("知识地图已生成");
    } catch (error: any) {
      toast.error(error?.message || "创建知识地图失败");
    } finally {
      setGenerating(false);
    }
  };

  const open = async (id: number) => {
    setChecked(new Set());
    await loadMap(id);
  };

  const expand = async (target = selected) => {
    if (!map || !target || expanding) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error("请先配置 AI 提供商");
      return;
    }
    setExpanding(true);
    try {
      const nodes = await expandNode(provider, map.root_label, target, levels, map.nodes.map((node) => node.label));
      if (!nodes.length) throw new Error("模型没有返回可用条目");
      await db.addKnowledgeNodes(map.id, target.id, nodes);
      await loadMap(map.id, target.id);
    } catch (error: any) {
      toast.error(error?.message || "扩展失败，可以单独重试");
    } finally {
      setExpanding(false);
    }
  };

  const explore = async (query: string) => {
    if (!map || !current || expanding) return;
    const provider = findBestProvider();
    if (!provider) {
      toast.error("请先配置 AI 提供商");
      return;
    }
    setExpanding(true);
    try {
      const [id] = await db.addKnowledgeNodes(map.id, current.id, [{ kind: "topic", label: query, zh: "", level: "", note: `从 ${current.label} 延伸的新分支` }]);
      const fresh = await db.getKnowledgeMap(map.id);
      if (!fresh) throw new Error("无法读取知识地图");
      const target = fresh.nodes.find((node) => node.id === id);
      if (!target) throw new Error("无法创建探索分支");
      setMap(fresh);
      setSelected(target);
      const generated = await expandNode(provider, map.root_label, target, levels, fresh.nodes.map((node) => node.label));
      if (!generated.length) throw new Error("模型没有返回可用条目");
      await db.addKnowledgeNodes(map.id, target.id, generated);
      await loadMap(map.id, target.id);
      toast.success(`已展开 “${query}”`);
    } catch (error: any) {
      toast.error(error?.message || "探索失败，可以重试");
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
      toast.success(`已加入 ${result.added + result.linked} 个词`);
      setChecked(new Set());
      if (map) await loadMap(map.id, selected?.id);
    }
  };

  const addOne = async (id: number) => {
    const result = await db.addMapWordsToVocabulary([id]);
    if (result.added + result.linked) {
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success("已加入 Vocabulary");
      if (map) await loadMap(map.id, selected?.id);
    }
  };

  if (!map) return <div className="mx-auto max-w-5xl p-8">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Infinite Knowledge Map</p>
    <h1 className="mt-2 font-serif text-4xl font-bold">无限知识地图</h1>
    <p className="mt-2 text-muted-foreground">输入任意单词、场景或 Topic，快速展开一大片相关英语知识。</p>
    <div className="mt-7 flex gap-2">
      <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder="例如：Kitchen、job interview、distributed systems、bank" className="h-11 flex-1 rounded-xl border bg-background px-4 outline-none focus:ring-2 focus:ring-primary/40" />
      <Button onClick={create} disabled={generating || !input.trim()} className="h-11 px-6">{generating ? `生成中 ${progress}%` : "生成知识地图"}</Button>
    </div>
    {generating && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>}
    <h2 className="mb-3 mt-10 font-semibold">我的地图</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{maps.map((item) => <button key={item.id} onClick={() => open(item.id)} className="rounded-2xl border bg-card p-4 text-left hover:border-primary/50"><strong>{item.root_label}</strong><p className="mt-1 text-xs text-muted-foreground">{item.node_count} 个节点 · {item.root_type}</p></button>)}</div>
  </div>;

  const current = selected ?? map.nodes.find((node) => node.parent_id === null) ?? map.nodes[0];
  if (!current) return null;

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button variant="ghost" onClick={() => { setMap(null); setSelected(null); refreshList(); }}>← 我的地图</Button>
      <strong className="font-serif text-lg">{map.root_label}</strong>
      <span className="text-xs text-muted-foreground">{map.nodes.length} nodes</span>
      <KnowledgeSearch nodes={map.nodes} busy={expanding} onSelect={setSelected} onExplore={explore} />
      <div className="ml-auto flex items-center gap-2"><span className="text-xs text-muted-foreground">已选 {checked.size}</span><Button onClick={add} disabled={!checked.size} className="h-8 text-xs">加入 Vocabulary</Button></div>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,32%)_minmax(0,1fr)]">
      <KnowledgeOutline nodes={map.nodes} selectedId={current.id} onSelect={setSelected} onAdd={addOne} />
      <KnowledgeBoard nodes={map.nodes} current={current} checked={checked} expanding={expanding} onSelect={setSelected} onToggle={toggle} onExpand={() => expand(current)} />
    </div>
  </div>;
}
