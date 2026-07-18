import React, { useCallback, useEffect, useRef, useState } from "react";
import { WordDetailPanel } from "@/components/Vocabulary/WordDetailPanel";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { parseEnrichmentStream, type ParsedEnrichment } from "@/lib/enrichMeta";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";

const CACHE_PREFIX = "__KNOWLEDGE_ENRICHED__\n";

/** In-page panel showing the full AI enrichment for one map entry. */
export function EntryDetail({ node, listCollapsed, onToggleList, onPersist, onAdd, onClose }: {
  node: KnowledgeNode;
  listCollapsed: boolean;
  onToggleList: () => void;
  onPersist: (node: KnowledgeNode, enrichment: ParsedEnrichment) => Promise<void>;
  onAdd: (nodeId: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;
  const [enriched, setEnriched] = useState<ParsedEnrichment | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState("");

  const enrich = useCallback(async (signal?: AbortSignal) => {
    const provider = findBestProvider();
    if (!provider) { setError(t("modal.noProvider")); return; }
    setError("");
    setEnriched(null);
    setEnriching(true);
    let raw = "";
    try {
      for await (const chunk of provider.enrich(node.label, signal)) {
        if (signal?.aborted) return;
        raw += chunk;
        setEnriched(parseEnrichmentStream(raw));
      }
      const parsed = parseEnrichmentStream(raw);
      if (parsed.text.trim()) await onPersistRef.current(node, parsed);
    } catch (reason: any) {
      if (reason?.name !== "AbortError") setError(reason?.message || t("modal.noProvider"));
    } finally {
      if (!signal?.aborted) setEnriching(false);
    }
  }, [node.id, node.label, t]);

  useEffect(() => {
    if (node.note.startsWith(CACHE_PREFIX)) {
      setEnriched({ text: node.note.slice(CACHE_PREFIX.length), level: node.level || undefined, zhShort: node.zh || undefined });
      setEnriching(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    void enrich(controller.signal);
    return () => controller.abort();
  }, [node.id, node.note, enrich]);

  return <section className="flex h-full min-h-0 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <button
        onClick={onToggleList}
        title={listCollapsed ? t("knowledgeMap.showList") : t("knowledgeMap.hideList")}
        aria-label={listCollapsed ? t("knowledgeMap.showList") : t("knowledgeMap.hideList")}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >{listCollapsed ? "▸" : "◂"}</button>
      <span className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{t("knowledgeMap.detailTitle")}</span>
      <button onClick={onClose} aria-label={t("knowledgeMap.close")} className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col">
      <WordDetailPanel
        selected={{ word: node.label, zh: node.zh || null, wordType: null, level: node.level || null, ipa: "" }}
        wordId={node.word_id}
        enriched={enriched}
        enriching={enriching}
        enrichError={error}
        legacy={false}
        notes=""
        vocabBilingual
        lookupMode
        lookupAdded={Boolean(node.word_id)}
        onAddToVocab={() => onAdd(node.id)}
        onNotesChange={() => {}}
        onClearNotes={() => {}}
        onRetry={() => void enrich()}
        onReenrich={() => void enrich()}
      />
    </div>
  </section>;
}
