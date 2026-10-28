import { useState, useEffect, useRef, useMemo } from "react";
import { useDB, WordListItem, ScenarioWordItem } from "@/hooks/useDB";
import { toast } from "sonner";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";
import { BasicInfo } from "@/lib/basicInfo";
import { useVocabEnrichStore } from "@/store/vocabEnrichStore";

export interface SelectedWordData {
  word: WordListItem;
  enriched: ParsedEnrichment | null;
  legacy: boolean;
  notes: string;
}

/** A word looked up via AI that is not (yet) in the vocabulary */
export interface LookupData {
  word: string;
  enriched: ParsedEnrichment | null;
  basicInfo: BasicInfo;
  added: boolean;
  wordId: number | null;
}

/** The currently-open word detail panel: which word is selected (or being
 * looked up), its notes, and the enrichment-in-progress indicators that also
 * need to reflect a job started before this component (re)mounted. Enrich
 * actions themselves live in useVocabEnrichSelected / useVocabLookup — this
 * hook only owns the "what's open right now" state they read and write. */
export function useVocabWordDetail(db: ReturnType<typeof useDB>) {
  const [selected, setSelected] = useState<SelectedWordData | null>(null);
  const selectedRef = useRef<SelectedWordData | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [notes, setNotes] = useState("");
  /** The selected word's scenario links (chips row in the detail panel).
   *  Loaded on select; the parent's onSetScenes updates it optimistically. */
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);

  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const lookupControllerRef = useRef<AbortController | null>(null);

  // Reactive fallback for `enriching`: a single-word re-analyze started before this
  // component (re)mounted — e.g. the user navigated away and back — has no local state
  // to reflect it, but vocabEnrichStore does. Falls back to false once selected is null.
  const selectedWordJobRunning = useVocabEnrichStore(
    (s) => (selected ? s.singleJobs[selected.word.word]?.status === "running" : false)
  );
  const effectiveEnriching = enriching || selectedWordJobRunning;

  // Same idea for the streamed text itself: while a job for the selected word is running,
  // its partial output lives in the store, so selecting another word and coming back shows
  // everything that arrived in between instead of an empty panel.
  const selectedWordJobText = useVocabEnrichStore(
    (s) => (selected ? s.singleTexts[selected.word.word] ?? "" : "")
  );
  const streamingEnriched = useMemo(
    () => (selectedWordJobRunning && selectedWordJobText ? parseEnrichmentStream(selectedWordJobText) : null),
    [selectedWordJobRunning, selectedWordJobText]
  );

  // ── Select word (from the vocabulary list) ───────────────────────────────

  // Stale-response guard: keyboard navigation / rapid clicks can stack several
  // selectWord fetches in flight, and a slow earlier one must never overwrite
  // the word the user has already moved on to. Last call wins.
  const selectSeq = useRef(0);

  const selectWord = async (w: WordListItem) => {
    const seq = ++selectSeq.current;
    // Only the throwaway lookup stream is cancelled here. A saved word's enrichment keeps
    // running in the background (vocabEnrichStore tracks it, CommandBar shows it) so that
    // switching words mid-analysis doesn't discard work — coming back re-attaches to it.
    lookupControllerRef.current?.abort();
    setEnriching(false);
    setEnrichError("");
    setLookup(null);
    setNotes("");
    setSelectedScenes([]);
    try {
      const [detail, extras, scenes] = await Promise.all([
        db.getWordDetail(w.id),
        db.getWordExtras(w.id),
        db.getWordScenarios(w.id),
      ]);
      if (seq !== selectSeq.current) return; // superseded mid-flight

      let enriched: ParsedEnrichment | null = null;
      let legacy = false;
      if (detail?.enrichment_text) {
        enriched = { text: detail.enrichment_text, level: detail.level ?? undefined, zhShort: detail.definitions?.[0]?.zh };
      } else if (detail?.enrichment_json) {
        legacy = true;
      }

      const wordNotes = extras?.notes || "";
      setNotes(wordNotes);
      // Scene membership rides along the selection load — one row per link,
      // key-only (never the internal integer id).
      setSelectedScenes(scenes.map((sc) => sc.scenario_key));
      setSelected({ word: w, enriched, legacy, notes: wordNotes });
    } catch {
      if (seq !== selectSeq.current) return;
      setSelected({ word: w, enriched: null, legacy: false, notes: "" });
      setSelectedScenes([]);
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

  return {
    selected, setSelected, selectedRef,
    lookup, setLookup,
    notes, setNotes,
    selectedScenes, setSelectedScenes,
    enriching, setEnriching,
    enrichError, setEnrichError,
    lookupControllerRef,
    effectiveEnriching, selectedWordJobRunning, streamingEnriched,
    selectWord, saveNotes,
  };
}

export type VocabWordDetailState = ReturnType<typeof useVocabWordDetail>;
