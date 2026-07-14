import React, { useCallback, useEffect, useRef, useState } from "react";
import { WordDetailPanel } from "@/components/Vocabulary/WordDetailPanel";
import type { KnowledgeNode } from "@/features/knowledge-map/types";
import { parseEnrichmentStream, type ParsedEnrichment } from "@/lib/enrichMeta";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";

const CACHE_PREFIX = "__KNOWLEDGE_ENRICHED__\n";

export function KnowledgeWordDetail({ node, onPersist, onAdd }: {
  node: KnowledgeNode;
  onPersist: (node: KnowledgeNode, enrichment: ParsedEnrichment) => Promise<void>;
  onAdd: (nodeId: number) => void;
}) {
  const t = useT();
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;
  const [enriched, setEnriched] = useState<ParsedEnrichment | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState("");

  const enrich = useCallback(async (signal?: AbortSignal) => {
    const provider = findBestProvider();
    if (!provider) {
      setError(t("modal.noProvider"));
      return;
    }
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

  return <WordDetailPanel
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
  />;
}
