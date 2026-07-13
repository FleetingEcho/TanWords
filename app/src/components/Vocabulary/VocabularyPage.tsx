import React, { useState, useEffect, useMemo, useRef } from "react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useWordModalStore } from "@/store/wordModalStore";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { WordListPanel, LevelFilter, SortBy, DateField } from "./WordListPanel";
import { WordDetailPanel } from "./WordDetailPanel";
import { GenerateVocabModal } from "./GenerateVocabModal";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";

interface SelectedWordData {
  word: WordListItem;
  enriched: ParsedEnrichment | null;
  legacy: boolean;
  notes: string;
}

/** A word looked up via AI that is not (yet) in the vocabulary */
interface LookupData {
  word: string;
  enriched: ParsedEnrichment | null;
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

  // Filters
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateField, setDateField] = useState<DateField>("created");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [generateOpen, setGenerateOpen] = useState(false);

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
      dateField,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
    setWords(results);
    setPage(0);
  };

  useEffect(() => { loadWords(); }, [levelFilter, sortBy, debouncedSearch, dateField, dateFrom, dateTo]);

  // Full, unfiltered vocabulary set — used for dedup in GenerateVocabModal, which
  // must check against the whole vocabulary regardless of the list's current filters.
  const [allWordsSet, setAllWordsSet] = useState<Set<string>>(new Set());
  const loadAllWordsSet = async () => {
    const all = await db.getWords();
    setAllWordsSet(new Set(all.map((w) => w.word.toLowerCase())));
  };
  useEffect(() => { loadAllWordsSet(); }, []);

  useEffect(() => {
    const handler = () => { loadWords(); loadAllWordsSet(); };
    window.addEventListener("vocab-updated", handler);
    return () => window.removeEventListener("vocab-updated", handler);
  }, [levelFilter, sortBy, debouncedSearch, dateField, dateFrom, dateTo]);

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

      let enriched: ParsedEnrichment | null = null;
      let legacy = false;
      if (detail?.enrichment_text) {
        enriched = { text: detail.enrichment_text, level: detail.level ?? undefined, zhShort: detail.definitions?.[0]?.zh };
      } else if (detail?.enrichment_json) {
        legacy = true;
      }

      const wordNotes = extras?.notes || "";
      setNotes(wordNotes);
      setSelected({ word: w, enriched, legacy, notes: wordNotes });
    } catch {
      setSelected({ word: w, enriched: null, legacy: false, notes: "" });
    }
  };

  // ── Enrich a saved word (explicit trigger from the detail panel) ─────────

  const enrichSelected = async (word: string) => {
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
    setSelected((prev) => prev ? { ...prev, legacy: false } : prev);

    let raw = "";
    try {
      for await (const chunk of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        raw += chunk;
        const parsed = parseEnrichmentStream(raw);
        setSelected((prev) => prev?.word.word === word ? { ...prev, enriched: parsed } : prev);
      }
      if (controller.signal.aborted) return;

      const final = parseEnrichmentStream(raw);
      await db.addWordEnriched(word, final.zhShort || word, null, {
        text: final.text,
        zhShort: final.zhShort,
        level: final.level,
      }).catch(() => {});

      toast.success(`「${word}」AI 分析完成`);
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

    let raw = "";
    try {
      for await (const chunk of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        raw += chunk;
        const parsed = parseEnrichmentStream(raw);
        setLookup((prev) => prev?.word === word ? { ...prev, enriched: parsed } : prev);
      }
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
    try {
      const result = await db.addWordEnriched(lookup.word, lookup.enriched.zhShort || lookup.word, null, {
        text: lookup.enriched.text,
        zhShort: lookup.enriched.zhShort,
        level: lookup.enriched.level,
      });
      setLookup((prev) => prev ? { ...prev, added: true, wordId: result.id } : prev);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(`「${lookup.word}」已加入词库`);
    } catch {
      toast.error(t("vocab.aiError"));
    }
  };

  // ── Notes (autosaved by LazyWordNotesEditor) ────────────────────────────

  const saveNotes = async (text: string) => {
    if (!selected) return;
    setNotes(text);
    try {
      await db.saveWordNotes(selected.word.id, text);
      window.dispatchEvent(new CustomEvent("word-notes-updated", { detail: { wordId: selected.word.id, notes: text } }));
    } catch {
      toast.error("保存失败，请重试");
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

  const activeEnriched = lookup ? lookup.enriched : selected?.enriched ?? null;
  const chatWord = lookup ? lookup.word : selected?.word.word ?? "";
  const chatWordId = lookup ? lookup.wordId : selected?.word.id ?? null;

  // Publish the selected word so ToolsModal's word-chat tab can show it.
  const setSelectedWord = useSelectedWordStore((s) => s.setSelectedWord);
  const clearSelectedWord = useSelectedWordStore((s) => s.clear);
  useEffect(() => {
    setSelectedWord({ wordId: chatWordId, word: chatWord, enrichedContext: activeEnriched?.text || "" });
  }, [chatWordId, chatWord, activeEnriched, setSelectedWord]);
  useEffect(() => () => clearSelectedWord(), [clearSelectedWord]);

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
        dateField={dateField}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        onSortChange={setSortBy}
        onFilterChange={setLevelFilter}
        onSourceFilterChange={setSourceFilter}
        onDateFieldChange={setDateField}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onSelect={selectWord}
        onPageChange={setPage}
        onDoubleClick={(word) => openWordModal(word)}
        onAiLookup={startLookup}
        onOpenGenerate={() => setGenerateOpen(true)}
      />

      <WordDetailPanel
        selected={{
          word: lookup ? lookup.word : selected?.word.word ?? "",
          zh: lookup ? lookup.enriched?.zhShort ?? null : selected?.word.zh ?? null,
          wordType: lookup ? null : selected?.word.word_type ?? null,
          level: lookup ? lookup.enriched?.level ?? null : selected?.word.level ?? null,
          ipa: "",
        }}
        wordId={lookup ? null : selected?.word.id ?? null}
        enriched={activeEnriched}
        enriching={enriching}
        enrichError={enrichError}
        legacy={lookup ? false : selected?.legacy ?? false}
        notes={notes}
        vocabBilingual={vocabBilingual}
        lookupMode={!!lookup}
        lookupAdded={lookup?.added ?? false}
        onAddToVocab={addLookupToVocab}
        onNotesChange={saveNotes}
        onClearNotes={() => saveNotes("")}
        onRetry={() => {
          if (lookup) startLookup(lookup.word);
          else if (selected) enrichSelected(selected.word.word);
        }}
        onReenrich={() => selected && enrichSelected(selected.word.word)}
      />

      <GenerateVocabModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        existingWords={allWordsSet}
        onAdded={() => { loadWords(); loadAllWordsSet(); }}
      />
    </div>
  );
}
