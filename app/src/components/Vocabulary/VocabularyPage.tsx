import React, { useState, useEffect, useMemo, useRef } from "react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useWordModalStore } from "@/store/wordModalStore";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { FloatingChatButton } from "@/components/WordChatPanel";
import { WordListPanel, LevelFilter, SortBy } from "./WordListPanel";
import { WordDetailPanel, EnrichedData } from "./WordDetailPanel";

interface SelectedWordData {
  word: WordListItem;
  enriched: EnrichedData | null;
  phonetics: { ipa: string; locale: string }[];
  notes: string;
}

/** A word looked up via AI that is not (yet) in the vocabulary */
interface LookupData {
  word: string;
  enriched: EnrichedData | null;
  added: boolean;
  wordId: number | null;
}

const PAGE_SIZE = 50;

export function VocabularyPage({ initialWordId }: { initialWordId?: number }) {
  const db = useDB();
  const openWordModal = useWordModalStore((s) => s.openWordModal);

  // Data
  const [words, setWords] = useState<WordListItem[]>([]);
  const [selected, setSelected] = useState<SelectedWordData | null>(null);
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [notes, setNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  // Filters
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Enrichment
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const enrichControllerRef = useRef<AbortController | null>(null);
  const vocabBilingual = useSettingsStore((s) => s.vocabBilingual);
  const t = useT();

  useEffect(() => {
    return () => enrichControllerRef.current?.abort();
  }, []);

  const loadWords = async () => {
    const results = await db.getWords({
      search: debouncedSearch || undefined,
      levelFilter: levelFilter === "all" ? undefined : levelFilter,
      sortBy,
    });
    setWords(results);
    setPage(0);
  };

  useEffect(() => { loadWords(); }, [levelFilter, sortBy, debouncedSearch]);

  useEffect(() => {
    const handler = () => loadWords();
    window.addEventListener("vocab-updated", handler);
    return () => window.removeEventListener("vocab-updated", handler);
  }, [levelFilter, sortBy, debouncedSearch]);

  // Source filtering is client-side: getWords returns the full result set
  const sources = useMemo(
    () => [...new Set(words.map((w) => w.source))].sort(),
    [words]
  );
  const visibleWords = useMemo(
    () => (sourceFilter === "all" ? words : words.filter((w) => w.source === sourceFilter)),
    [words, sourceFilter]
  );

  // Dictionary behavior: the searched term isn't in the vocabulary → offer AI lookup
  const showAiLookup = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || !/^[a-z][a-z\s'-]*$/i.test(q)) return false;
    return !words.some((w) => w.word.toLowerCase() === q);
  }, [debouncedSearch, words]);

  // ── Select word (from the vocabulary list) ───────────────────────────────

  const selectWord = async (w: WordListItem) => {
    enrichControllerRef.current?.abort();
    setEnriching(false);
    setEnrichError("");
    setLookup(null);
    setNotes("");
    try {
      const [detail, extras] = await Promise.all([
        db.getWordDetail(w.id),
        db.getWordExtras(w.id),
      ]);
      let enriched: EnrichedData | null = null;
      const phonetics = detail?.phonetics || [];

      if (detail?.enrichment_json) {
        try { enriched = JSON.parse(detail.enrichment_json); } catch {}
      }

      const wordNotes = extras?.notes || "";
      setNotes(wordNotes);
      // Incomplete enrichment no longer auto-triggers an AI call — the detail
      // panel offers an explicit button, so browsing the list stays free.
      setSelected({ word: w, enriched, phonetics, notes: wordNotes });
    } catch {
      setSelected({ word: w, enriched: null, phonetics: [], notes: "" });
    }
  };

  // ── Enrich a saved word (explicit trigger from the detail panel) ─────────

  const enrichSelected = async (word: string, existingEnriched: EnrichedData | null) => {
    const provider = findBestProvider();
    if (!provider) {
      setEnrichError(t("vocab.noApiKey"));
      return;
    }
    enrichControllerRef.current?.abort();
    const controller = new AbortController();
    enrichControllerRef.current = controller;

    setEnriching(true);
    setEnrichError("");
    const finalEnrichment: Partial<import("@/providers/base").WordEnrichment> = { ...(existingEnriched as any) };
    setSelected((prev) => prev ? { ...prev, enriched: (existingEnriched ?? {}) as EnrichedData } : prev);

    try {
      for await (const partial of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        Object.assign(finalEnrichment, partial);
        setSelected((prev) => prev?.word.word === word ? {
          ...prev,
          enriched: { ...(prev.enriched || {}), ...partial } as EnrichedData,
        } : prev);
      }
      if (controller.signal.aborted) return;

      await db.addWordEnriched(
        word,
        finalEnrichment.definitions?.[0]?.zh || word,
        finalEnrichment.definitions?.[0]?.pos || null,
        {
          definitions: finalEnrichment.definitions || [],
          synonyms: finalEnrichment.synonyms || [],
          antonyms: finalEnrichment.antonyms || [],
          collocations: finalEnrichment.collocations || [],
          derivatives: (finalEnrichment.derivatives || []).map((d: any) => ({ word: d.word, wordType: d.wordType, zh: d.zh })),
          sentencePatterns: finalEnrichment.sentencePatterns || [],
          idioms: finalEnrichment.idioms || [],
          authorityQuotes: finalEnrichment.sentences?.map(s => ({ text: s.text, source: s.label })) || finalEnrichment.authorityQuotes || [],
          etymology: finalEnrichment.etymology?.parts?.length ? {
            parts: finalEnrichment.etymology.parts,
            story: finalEnrichment.etymology.story,
            originLang: finalEnrichment.etymology.originLang,
          } : undefined,
          level: finalEnrichment.level,
          mnemonic: finalEnrichment.mnemonic,
          complete: true,
        }
      ).catch(() => {});

      toast.success(`「${word}」AI 分析完成`);
      setSelected((prev) => prev?.word.word === word ? {
        ...prev,
        enriched: { ...(prev.enriched || {}), complete: true } as EnrichedData,
      } : prev);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      const errMsg = e.message?.includes("Load failed") || e.message?.includes("fetch")
        ? t("vocab.networkError")
        : (e.message || t("vocab.aiError"));
      setEnrichError(errMsg);
      toast.error(errMsg);
    } finally {
      if (!controller.signal.aborted) setEnriching(false);
    }
  };

  // ── AI dictionary lookup (word not in the vocabulary) ───────────────────

  const startLookup = async (query: string) => {
    const word = query.trim();
    if (!word || enriching) return;

    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }

    enrichControllerRef.current?.abort();
    const controller = new AbortController();
    enrichControllerRef.current = controller;

    setSelected(null);
    setLookup({ word, enriched: null, added: false, wordId: null });
    setEnriching(true);
    setEnrichError("");

    const final: Partial<import("@/providers/base").WordEnrichment> = {};
    try {
      for await (const partial of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        Object.assign(final, partial);
        setLookup((prev) => prev?.word === word ? {
          ...prev,
          enriched: { ...(prev.enriched || {}), ...partial } as EnrichedData,
        } : prev);
      }
      if (controller.signal.aborted) return;
      setLookup((prev) => prev?.word === word ? {
        ...prev,
        enriched: { ...(prev.enriched || {}), complete: true } as EnrichedData,
      } : prev);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      const errMsg = e.message?.includes("Load failed") || e.message?.includes("fetch")
        ? t("vocab.networkError")
        : (e.message || t("vocab.aiError"));
      setEnrichError(errMsg);
      toast.error(errMsg);
    } finally {
      if (!controller.signal.aborted) setEnriching(false);
    }
  };

  const addLookupToVocab = async () => {
    if (!lookup?.enriched || lookup.added) return;
    const e = lookup.enriched as any;
    try {
      const result = await db.addWordEnriched(
        lookup.word,
        e.definitions?.[0]?.zh || lookup.word,
        e.definitions?.[0]?.pos || null,
        {
          definitions: e.definitions || [],
          synonyms: e.synonyms || [],
          antonyms: e.antonyms || [],
          collocations: e.collocations || [],
          derivatives: (e.derivatives || []).map((d: any) => ({ word: d.word, wordType: d.wordType, zh: d.zh })),
          sentencePatterns: e.sentencePatterns || [],
          idioms: e.idioms || [],
          authorityQuotes: e.sentences?.map((s: any) => ({ text: s.text, source: s.label })) || e.authorityQuotes || [],
          etymology: e.etymology?.parts?.length ? {
            parts: e.etymology.parts,
            story: e.etymology.story,
            originLang: e.etymology.originLang,
          } : undefined,
          level: e.level,
          mnemonic: e.mnemonic,
          complete: true,
        }
      );
      setLookup((prev) => prev ? { ...prev, added: true, wordId: result.id } : prev);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(`「${lookup.word}」已加入词库`);
    } catch {
      toast.error(t("vocab.aiError"));
    }
  };

  // ── Notes ────────────────────────────────────────────────────────────────

  const saveNotes = async () => {
    if (!selected) return;
    setNotesSaving(true);
    try {
      await db.saveWordNotes(selected.word.id, notes);
      window.dispatchEvent(new CustomEvent("word-notes-updated", { detail: { wordId: selected.word.id, notes } }));
      toast.success("笔记已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setNotesSaving(false);
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { wordId, notes: updatedNotes } = (e as CustomEvent).detail;
      if (selected?.word.id === wordId) setNotes(updatedNotes);
    };
    window.addEventListener("word-notes-updated", handler);
    return () => window.removeEventListener("word-notes-updated", handler);
  }, [selected?.word.id]);

  // ── Initial selection ───────────────────────────────────────────────────

  useEffect(() => {
    if (lookup) return;
    if (initialWordId && words.length > 0) {
      const w = words.find((x) => x.id === initialWordId);
      if (w) selectWord(w);
    } else if (words.length > 0 && !selected) {
      selectWord(words[0]);
    }
  }, [words.length, initialWordId]);

  // ── Render ──────────────────────────────────────────────────────────────

  const ipa = selected?.phonetics?.find((p) => p.locale === "en-US" || p.locale === "en-GB")?.ipa || "";
  const activeEnriched = lookup ? lookup.enriched : selected?.enriched ?? null;
  const chatWord = lookup ? lookup.word : selected?.word.word ?? "";
  const chatWordId = lookup ? lookup.wordId : selected?.word.id ?? null;

  return (
    <div className="flex h-full">
      <WordListPanel
        words={visibleWords}
        selectedId={selected?.word.id ?? null}
        search={search}
        sortBy={sortBy}
        levelFilter={levelFilter}
        sourceFilter={sourceFilter}
        sources={sources}
        page={page}
        pageSize={PAGE_SIZE}
        showAiLookup={showAiLookup}
        lookupActive={!!lookup}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        onSortChange={setSortBy}
        onFilterChange={setLevelFilter}
        onSourceFilterChange={setSourceFilter}
        onSelect={selectWord}
        onPageChange={setPage}
        onDoubleClick={(word) => openWordModal(word)}
        onAiLookup={startLookup}
      />

      <WordDetailPanel
        selected={{
          word: lookup ? lookup.word : selected?.word.word ?? "",
          zh: lookup ? (lookup.enriched as any)?.definitions?.[0]?.zh ?? null : selected?.word.zh ?? null,
          wordType: lookup ? null : selected?.word.word_type ?? null,
          level: lookup ? (lookup.enriched as any)?.level ?? null : selected?.word.level ?? null,
          ipa: lookup ? "" : ipa,
        }}
        enriched={activeEnriched}
        enriching={enriching}
        enrichError={enrichError}
        notes={notes}
        vocabBilingual={vocabBilingual}
        lookupMode={!!lookup}
        lookupAdded={lookup?.added ?? false}
        onAddToVocab={addLookupToVocab}
        onNotesChange={setNotes}
        onSaveNotes={saveNotes}
        notesSaving={notesSaving}
        onClearNotes={() => {
          setNotes("");
          if (selected) {
            db.saveWordNotes(selected.word.id, "").then(() => {
              window.dispatchEvent(new CustomEvent("word-notes-updated", { detail: { wordId: selected.word.id, notes: "" } }));
            });
          }
        }}
        onRetry={() => {
          if (lookup) startLookup(lookup.word);
          else if (selected) enrichSelected(selected.word.word, null);
        }}
        onReenrich={() => selected && enrichSelected(selected.word.word, null)}
      />

      {chatWord && (
        <FloatingChatButton
          wordId={chatWordId}
          word={chatWord}
          enrichedContext={activeEnriched ? JSON.stringify({
            definitions: (activeEnriched as any).definitions?.slice(0, 3),
            synonyms: (activeEnriched as any).synonyms?.slice(0, 4),
            level: (activeEnriched as any).level,
            etymology: (activeEnriched as any).etymology,
            mnemonic: (activeEnriched as any).mnemonic,
          }) : ""}
        />
      )}
    </div>
  );
}
