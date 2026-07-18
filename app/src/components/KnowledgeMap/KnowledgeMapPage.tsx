import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { PATTERN_SAVED_PREFIX, type KnowledgeMapDetail, type KnowledgeMapSummary, type KnowledgeNode } from "@/features/knowledge-map/types";
import { classifyInput, generateSection, suggestSubtopics, DEEP_DIVE_SECTION, SECTION_PRESETS, type RootType } from "@/features/knowledge-map/generator";
import type { ParsedEnrichment } from "@/lib/enrichMeta";
import { TopicView, hasDetail } from "./TopicView";
import { EntryDetail } from "./EntryDetail";
import { SentenceAnalysisView, WordAnalysis } from "./InstantAnalysis";

const SUGGEST_PREFIX = "__SUGGEST__\n";
const EXAMPLE_TOPICS = ["kitchen", "job interview", "distributed systems", "bank"];

type Analysis = { kind: "word" | "sentence"; text: string };

export default function KnowledgeMapPage() {
  const db = useDB();
  const t = useT();
  const levels = useSettingsStore((state) => state.targetLevels.join("/"));
  const uiLanguage = useSettingsStore((state) => state.uiLanguage);

  const [input, setInput] = useState("");
  const [maps, setMaps] = useState<KnowledgeMapSummary[]>([]);
  const [map, setMap] = useState<KnowledgeMapDetail | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [detailId, setDetailId] = useState<number | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busySectionId, setBusySectionId] = useState<number | null>(null);
  const [digging, setDigging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeMapSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [addAllOpen, setAddAllOpen] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const activeGenerationRef = useRef<{ cancelled: boolean } | null>(null);

  const refreshList = useCallback(() => db.listKnowledgeMaps().then(setMaps), [db]);
  useEffect(() => { refreshList(); }, [refreshList]);

  const loadMap = async (id: number) => {
    const value = await db.getKnowledgeMap(id);
    if (value) setMap(value);
    return value;
  };

  const root = useMemo(() => map?.nodes.find((node) => node.parent_id === null) ?? null, [map]);
  const suggestions = useMemo((): Array<[string, string]> => {
    if (!root?.note.startsWith(SUGGEST_PREFIX)) return [];
    try {
      const data = JSON.parse(root.note.slice(SUGGEST_PREFIX.length));
      return (Array.isArray(data) ? data : []).filter((x: any) => Array.isArray(x) && x[0]);
    } catch { return []; }
  }, [root]);
  const detailNode = useMemo(() => map?.nodes.find((node) => node.id === detailId) ?? null, [map, detailId]);

  const notifyVocabUpdated = () => window.dispatchEvent(new CustomEvent("vocab-updated"));

  const createMap = async (rawTopic: string) => {
    const topic = rawTopic.trim();
    if (!topic || generating) return;
    const provider = findBestProvider();
    if (!provider) { toast.error(t("knowledgeMap.configureAI")); return; }
    const generation = { cancelled: false };
    activeGenerationRef.current = generation;
    setAnalysis(null);
    setChecked(new Set());
    setGenerating(true);
    setProgress(0);
    let id: number | undefined;
    try {
      const rootType: RootType = classifyInput(topic) === "word" ? "word" : "topic";
      const sections = SECTION_PRESETS[rootType];
      id = await db.createKnowledgeMap(topic, rootType, levels);
      if (!id) return;
      const created = await db.getKnowledgeMap(id);
      const rootNode = created?.nodes.find((node) => node.parent_id === null);
      if (!rootNode) return;
      const categoryIds = await db.addKnowledgeNodes(id, rootNode.id, sections.map((section) => ({ kind: "category", label: section.label, zh: section.zh, level: "", note: section.key })));
      if (generation.cancelled) { await db.deleteKnowledgeMap(id); await refreshList(); return; }
      await loadMap(id);
      setProgress(5);
      const known = (await db.getWords()).map((word) => word.word);
      let finished = 0;
      for (let start = 0; start < categoryIds.length && !generation.cancelled; start += 2) {
        await Promise.allSettled(categoryIds.slice(start, start + 2).map(async (categoryId, offset) => {
          const section = sections[start + offset];
          const exclude = section.itemKind === "word" ? known : [];
          const items = await generateSection(provider, topic, section, levels, exclude);
          if (generation.cancelled) return;
          await db.addKnowledgeNodes(id!, categoryId, items);
          finished += 1;
          setProgress(Math.round(finished / sections.length * 85 + 5));
        }));
        if (!generation.cancelled) await loadMap(id);
      }
      if (!generation.cancelled) {
        const subtopics = await suggestSubtopics(provider, topic, sections.map((section) => section.zh)).catch(() => []);
        if (subtopics.length) await db.updateKnowledgeNodeNote(rootNode.id, SUGGEST_PREFIX + JSON.stringify(subtopics));
      }
      if (generation.cancelled) { await db.deleteKnowledgeMap(id); await refreshList(); return; }
      setProgress(100);
      await loadMap(id);
      await refreshList();
      toast.success(t("knowledgeMap.mapGenerated"));
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.createFailed"));
    } finally {
      if (activeGenerationRef.current === generation) setGenerating(false);
    }
  };

  const cancelGeneration = () => {
    const generation = activeGenerationRef.current;
    if (!generating || !generation || generation.cancelled) return;
    generation.cancelled = true;
    setGenerating(false);
    setMap(null);
    toast.info(t("knowledgeMap.generationCancelled"));
  };

  const submit = (forced?: "expand" | "analyze") => {
    const text = input.trim();
    if (!text || generating) return;
    const kind = classifyInput(text);
    const action = forced ?? (kind === "sentence" ? "analyze" : "expand");
    if (action === "expand") { void createMap(text); }
    else { setMap(null); setChecked(new Set()); setAnalysis({ kind: kind === "sentence" ? "sentence" : "word", text }); }
    setInput("");
  };

  const expandAsTopic = (label: string) => { setAnalysis(null); void createMap(label); };

  const openMap = async (id: number) => {
    if (generating) return;
    setAnalysis(null);
    setChecked(new Set());
    setDetailId(null);
    setListCollapsed(false);
    await loadMap(id);
  };

  const removeMap = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const deleted = await db.deleteKnowledgeMap(deleteTarget.id);
    if (deleted) {
      toast.success(t("knowledgeMap.deleted"));
      if (map?.id === deleteTarget.id) { setMap(null); setChecked(new Set()); }
      setDeleteTarget(null);
      await refreshList();
    } else {
      toast.error(t("knowledgeMap.deleteFailed"));
    }
    setDeleting(false);
  };

  const toggle = (id: number) => setChecked((previous) => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectSection = (ids: number[], select: boolean) => setChecked((previous) => {
    const next = new Set(previous);
    ids.forEach((id) => select ? next.add(id) : next.delete(id));
    return next;
  });

  const addNodes = async (nodeIds: number[], clear: boolean) => {
    if (!nodeIds.length) return;
    const result = await db.addMapWordsToVocabulary(nodeIds);
    if (result.added + result.linked) {
      notifyVocabUpdated();
      toast.success(t("knowledgeMap.wordsAdded", { count: result.added + result.linked }));
      if (clear) setChecked(new Set());
      if (map) await loadMap(map.id);
      await refreshList();
    }
  };

  const addAll = async () => {
    if (!map || addingAll) return;
    setAddingAll(true);
    try {
      await addNodes(map.nodes.filter((node) => hasDetail(node) && !node.word_id).map((node) => node.id), true);
      setAddAllOpen(false);
    } finally { setAddingAll(false); }
  };

  const moreSection = async (category: KnowledgeNode) => {
    if (!map || busySectionId !== null || generating) return;
    const provider = findBestProvider();
    if (!provider) { toast.error(t("knowledgeMap.configureAI")); return; }
    setBusySectionId(category.id);
    try {
      const section = SECTION_PRESETS[map.root_type as RootType]?.find((entry) => entry.key === category.note) ?? DEEP_DIVE_SECTION(category.label);
      const items = await generateSection(provider, map.root_label, section, levels, map.nodes.map((node) => node.label));
      if (!items.length) throw new Error(t("knowledgeMap.noModelItems"));
      await db.addKnowledgeNodes(map.id, category.id, items);
      await loadMap(map.id);
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.expandFailed"));
    } finally { setBusySectionId(null); }
  };

  const dig = async (label: string) => {
    if (!map || !root || digging || generating) return;
    const provider = findBestProvider();
    if (!provider) { toast.error(t("knowledgeMap.configureAI")); return; }
    setDigging(true);
    try {
      const [categoryId] = await db.addKnowledgeNodes(map.id, root.id, [{ kind: "category", label, zh: "", level: "", note: "deep" }]);
      if (!categoryId) throw new Error(t("knowledgeMap.expandFailed"));
      await loadMap(map.id);
      const items = await generateSection(provider, `${map.root_label} — ${label}`, DEEP_DIVE_SECTION(label), levels, map.nodes.map((node) => node.label));
      if (!items.length) throw new Error(t("knowledgeMap.noModelItems"));
      await db.addKnowledgeNodes(map.id, categoryId, items);
      await loadMap(map.id);
    } catch (error: any) {
      toast.error(error?.message || t("knowledgeMap.expandFailed"));
    } finally { setDigging(false); }
  };

  const savePattern = async (node: KnowledgeNode) => {
    if (!map || node.note.startsWith(PATTERN_SAVED_PREFIX)) return;
    // A node the user once opened in the detail panel carries the full AI
    // enrichment dump in its note — that's word-lookup content, not a usage
    // note; never copy it into the pattern library.
    const note = node.note.startsWith("__") ? "" : node.note;
    const saved = await db.saveSentencePattern(node.label, node.zh, "", note, node.level, "knowledge-map");
    if (saved) {
      await db.updateKnowledgeNodeNote(node.id, PATTERN_SAVED_PREFIX + node.note);
      toast.success(t("knowledgeMap.sentenceSaved"));
      await loadMap(map.id);
    }
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
    notifyVocabUpdated();
    toast.success(t("knowledgeMap.analyzedAndAdded", { word: node.label }));
    await loadMap(map.id);
  };

  const locale = uiLanguage === "zh" ? zhCN : enUS;

  return <><div className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 border-b px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center gap-2">
        <div className="flex h-10 flex-1 items-center rounded-xl border bg-background px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <span className="mr-2 text-muted-foreground">⌕</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder={t("knowledgeMap.inputPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <Button onClick={() => submit("expand")} disabled={generating || !input.trim()} className="h-10 px-4">⚡ {t("knowledgeMap.expand")}</Button>
        <Button variant="outline" onClick={() => submit("analyze")} disabled={generating || !input.trim()} className="h-10 px-4">{t("knowledgeMap.analyze")}</Button>
      </div>
      {generating && <div className="mx-auto mt-2 flex max-w-4xl items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
        <span className="text-xs text-primary">{t("knowledgeMap.generatingProgress", { progress })}</span>
        <button onClick={cancelGeneration} className="rounded-full border border-primary/30 px-2.5 py-0.5 text-[11px] font-medium text-primary transition hover:bg-primary/10">{t("knowledgeMap.cancelGeneration")}</button>
      </div>}
    </header>

    <div className="flex min-h-0 flex-1">
      {sidebarCollapsed
        ? <aside className="flex w-9 shrink-0 flex-col items-center border-r bg-muted/15 py-2">
            <button onClick={() => setSidebarCollapsed(false)} title={t("knowledgeMap.showSidebar")} aria-label={t("knowledgeMap.showSidebar")} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">▸</button>
          </aside>
        : <aside className="w-60 shrink-0 overflow-y-auto border-r bg-muted/15 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">
            <button onClick={() => setSidebarCollapsed(true)} title={t("knowledgeMap.hideSidebar")} aria-label={t("knowledgeMap.hideSidebar")} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">◂</button>
            {t("knowledgeMap.historyTitle")}
          </span>
          <button onClick={() => { if (!generating) { setMap(null); setAnalysis(null); setChecked(new Set()); } }} className="text-xs font-medium text-primary hover:underline">{t("knowledgeMap.newTopic")}</button>
        </div>
        <div className="space-y-1">
          {maps.map((item) => <div key={item.id} className={`group relative rounded-lg ${map?.id === item.id ? "bg-primary/10" : "hover:bg-muted"}`}>
            <button onClick={() => void openMap(item.id)} className="block w-full px-2.5 py-2 pr-8 text-left">
              <span className={`block truncate text-sm ${map?.id === item.id ? "font-semibold text-primary" : ""}`}>{item.root_label}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("knowledgeMap.nodes", { count: item.node_count })} · {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true, locale })}</span>
            </button>
            <button onClick={() => setDeleteTarget(item)} aria-label={`${t("knowledgeMap.delete")}: ${item.root_label}`} title={t("knowledgeMap.delete")} className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus:opacity-100">×</button>
          </div>)}
          {!maps.length && <p className="px-2 py-4 text-xs text-muted-foreground">{t("knowledgeMap.mapsEmpty")}</p>}
        </div>
      </aside>}

      <main className="flex min-h-0 flex-1">
        {analysis
          ? <div className="min-h-0 flex-1 overflow-y-auto">
              {analysis.kind === "sentence"
                ? <SentenceAnalysisView sentence={analysis.text} levels={levels} onExpandTopic={expandAsTopic} />
                : <WordAnalysis word={analysis.text} onExpandTopic={expandAsTopic} />}
            </div>
          : map
            ? <>
                {!(detailNode && listCollapsed) && <div className={`relative min-h-0 overflow-y-auto ${detailNode ? "w-[400px] shrink-0 border-r" : "flex-1"}`}>
                  <TopicView map={map} checked={checked} generating={generating} busySectionId={busySectionId} digging={digging} suggestions={suggestions}
                    onToggle={toggle} onOpenDetail={(node) => setDetailId(node.id)} onAddOne={(id) => void addNodes([id], false)} onSavePattern={(node) => void savePattern(node)}
                    onSelectSection={selectSection} onMore={(category) => void moreSection(category)} onDig={(label) => void dig(label)} onAddAll={() => setAddAllOpen(true)} />
                  {checked.size > 0 && <div className="sticky bottom-0 z-10 border-t bg-background/95 px-6 py-3 backdrop-blur">
                    <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{t("knowledgeMap.selectedCount", { count: checked.size })}</span>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setChecked(new Set())}>{t("knowledgeMap.clearSelection")}</Button>
                        <Button size="sm" onClick={() => void addNodes([...checked], true)}>{t("knowledgeMap.addSelected")} →</Button>
                      </div>
                    </div>
                  </div>}
                </div>}
                {detailNode && <div className="min-h-0 min-w-0 flex-1">
                  <EntryDetail node={detailNode} listCollapsed={listCollapsed} onToggleList={() => setListCollapsed((value) => !value)}
                    onPersist={persistDetail} onAdd={(id) => void addNodes([id], false)} onClose={() => { setDetailId(null); setListCollapsed(false); }} />
                </div>}
              </>
            : <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <p className="text-4xl">✨</p>
                <h1 className="mt-4 font-serif text-3xl font-bold">{t("knowledgeMap.emptyTitle")}</h1>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("knowledgeMap.emptySubtitle")}</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("knowledgeMap.tryExamples")}</span>
                  {EXAMPLE_TOPICS.map((example) => <button key={example} onClick={() => setInput(example)} className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground">{example}</button>)}
                </div>
              </div>}
      </main>
    </div>
  </div>

  <ConfirmModal
    open={Boolean(deleteTarget)}
    title={t("knowledgeMap.delete")}
    message={t("knowledgeMap.deleteConfirm", { name: deleteTarget?.root_label ?? "" })}
    confirmLabel={deleting ? t("knowledgeMap.deleting") : t("knowledgeMap.delete")}
    confirmDisabled={deleting}
    onConfirm={removeMap}
    onCancel={() => !deleting && setDeleteTarget(null)}
  />
  <ConfirmModal
    open={addAllOpen}
    title={t("knowledgeMap.addAllConfirmTitle")}
    message={t("knowledgeMap.addAllConfirmMessage", { count: map?.nodes.filter((node) => hasDetail(node) && !node.word_id).length ?? 0 })}
    confirmLabel={addingAll ? t("knowledgeMap.addingAll") : t("knowledgeMap.addAllVocabulary")}
    danger={false}
    confirmDisabled={addingAll}
    onConfirm={() => void addAll()}
    onCancel={() => !addingAll && setAddAllOpen(false)}
  /></>;
}
