import { useDB, WordListItem } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { parseEnrichmentStream } from "@/lib/enrichMeta";
import { fetchBasicInfo } from "@/lib/basicInfo";
import { useVocabEnrichStore } from "@/store/vocabEnrichStore";
import type { SelectedWordData } from "./useVocabWordDetail";

/** Explicit "analyze this word" trigger from the detail panel — as opposed to
 * the header's bulk actions (useVocabBulkEnrich) or the AI-dictionary lookup
 * for a word not yet in the vocabulary (useVocabLookup). */
export function useVocabEnrichSelected(params: {
  db: ReturnType<typeof useDB>;
  targetLevel: string;
  selectedRef: React.RefObject<SelectedWordData | null>;
  setSelected: React.Dispatch<React.SetStateAction<SelectedWordData | null>>;
  setWords: React.Dispatch<React.SetStateAction<WordListItem[]>>;
  setEnriching: React.Dispatch<React.SetStateAction<boolean>>;
  setEnrichError: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { db, targetLevel, selectedRef, setSelected, setWords, setEnriching, setEnrichError } = params;
  const t = useT();

  const enrichSelected = async (word: string) => {
    const provider = findBestProvider();
    if (!provider) {
      setEnrichError(t("vocab.noApiKey"));
      return;
    }
    const controller = useVocabEnrichStore.getState().startSingle(word);

    setEnriching(true);
    setEnrichError("");
    setSelected((prev) => prev ? { ...prev, enriched: null, legacy: false } : prev);

    let raw = "";
    try {
      // Update the list item (and the detail header) as soon as this resolves —
      // don't make it wait for the much slower full-explanation stream to finish.
      const basicInfoPromise = fetchBasicInfo(provider, word, targetLevel, controller.signal).then((info) => {
        if (controller.signal.aborted) return info;
        if (info.zh || info.level || info.wordType) {
          setWords((prev) => prev.map((w) => w.word === word
            ? { ...w, zh: info.zh || w.zh, level: info.level || w.level, word_type: info.wordType || w.word_type }
            : w));
          setSelected((prev) => prev && prev.word.word === word
            ? { ...prev, word: { ...prev.word, zh: info.zh || prev.word.zh, level: info.level || prev.word.level, word_type: info.wordType || prev.word.word_type } }
            : prev);
        }
        return info;
      });
      // The enrich stream is prompted to open with a `META: <level> | <short gloss>` line
      // (see parseEnrichmentStream) before the much longer explanation body — so the short
      // gloss is usually available within the first chunk or two. Apply it to the list/detail
      // state as soon as it shows up, once, rather than waiting for the whole stream (which
      // can take a while) to finish.
      let appliedStreamMeta = false;
      for await (const chunk of provider.enrich(word, controller.signal)) {
        if (controller.signal.aborted) break;
        raw += chunk;
        const parsed = parseEnrichmentStream(raw);
        useVocabEnrichStore.getState().setSingleText(word, raw);
        setSelected((prev) => prev?.word.word === word ? { ...prev, enriched: parsed } : prev);
        if (!appliedStreamMeta && (parsed.zhShort || parsed.level)) {
          appliedStreamMeta = true;
          const backfillZh = (current: string | null) => (current?.trim() ? current : parsed.zhShort || word);
          setWords((prev) => prev.map((w) => w.word === word
            ? { ...w, zh: backfillZh(w.zh), level: parsed.level || w.level }
            : w));
          setSelected((prev) => prev && prev.word.word === word
            ? { ...prev, word: { ...prev.word, zh: backfillZh(prev.word.zh), level: parsed.level || prev.word.level } }
            : prev);
        }
      }
      if (controller.signal.aborted) {
        useVocabEnrichStore.getState().clearSingle(word, controller);
        return;
      }

      const final = parseEnrichmentStream(raw);
      const basicInfo = await basicInfoPromise;
      const zhShort = basicInfo.zh || final.zhShort;
      const wordType = basicInfo.wordType || null;
      const level = basicInfo.level || final.level;
      await db.addWordEnriched(word, zhShort || word, wordType, {
        text: final.text,
        zhShort,
        level,
      }).catch(() => {});

      // The earlier optimistic update (right after basicInfoPromise resolves) only applied
      // info.zh — if that came back empty but the full enrichment stream's zhShort didn't,
      // the list would stay stuck showing no gloss even though the DB write above (which
      // uses that same zhShort fallback) succeeded. Sync the list/detail state to exactly
      // what got persisted so the two can never drift apart — including the "no gloss
      // already, and the AI didn't produce one either" case, where the backend backfills
      // the word itself rather than leaving the definition permanently blank.
      const backfillZh = (current: string | null) => (current?.trim() ? current : zhShort || word);
      if (zhShort || level || wordType) {
        setWords((prev) => prev.map((w) => w.word === word
          ? { ...w, zh: backfillZh(w.zh), level: level || w.level, word_type: wordType || w.word_type }
          : w));
      }
      // Also re-apply the finished text: the user may have re-selected this word after the
      // last chunk landed, in which case `selected` was rebuilt from a DB row that didn't
      // have the enrichment yet, and nothing else would fill it in.
      setSelected((prev) => prev && prev.word.word === word
        ? {
            ...prev,
            enriched: final,
            legacy: false,
            word: { ...prev.word, zh: backfillZh(prev.word.zh), level: level || prev.word.level, word_type: wordType || prev.word.word_type },
          }
        : prev);

      toast.success(`「${word}」 AI analyzed`);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      useVocabEnrichStore.getState().finishSingle(word, "done", controller);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // Cancelled (by the user, or by a newer re-analyze of this word taking over) —
        // drop the job so it can't leave the panel and the header stuck on "Analyzing".
        useVocabEnrichStore.getState().clearSingle(word, controller);
        return;
      }
      const errMsg = e.message?.includes("Load failed") || e.message?.includes("fetch")
        ? t("vocab.networkError")
        : (e.message || t("vocab.aiError"));
      if (selectedRef.current?.word.word === word) setEnrichError(errMsg);
      toast.error(errMsg);
      useVocabEnrichStore.getState().finishSingle(word, "error", controller);
    } finally {
      if (!controller.signal.aborted) setEnriching(false);
    }
  };

  return { enrichSelected };
}
