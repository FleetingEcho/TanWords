import { useState } from "react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { parseEnrichmentStream } from "@/lib/enrichMeta";
import { fetchBasicInfo } from "@/lib/basicInfo";
import { useVocabEnrichStore } from "@/store/vocabEnrichStore";
import type { SelectedWordData } from "./useVocabWordDetail";

/** How many words a bulk enrich analyzes concurrently */
const BULK_CONCURRENCY = 3;

/** Bulk (multi-word) enrichment: "enrich un-analyzed" / "re-analyze all" /
 * "re-analyze selected" from the Vocabulary page's header actions. Progress
 * lives in vocabEnrichStore (not component state) so it survives navigating
 * away mid-run — CommandBar's "Analyzing" indicator reads the same store, so
 * the job stays visible (and cancelable) from anywhere, not just while this
 * page is mounted. */
export function useVocabBulkEnrich(params: {
  db: ReturnType<typeof useDB>;
  targetLevel: string;
  setWords: React.Dispatch<React.SetStateAction<WordListItem[]>>;
  selectedRef: React.RefObject<SelectedWordData | null>;
  setSelected: React.Dispatch<React.SetStateAction<SelectedWordData | null>>;
  setEnriching: React.Dispatch<React.SetStateAction<boolean>>;
  loadWords: () => Promise<void>;
  loadAllWordsSet: () => Promise<void>;
}) {
  const { db, targetLevel, setWords, selectedRef, setSelected, setEnriching, loadWords, loadAllWordsSet } = params;
  const t = useT();

  const bulk = useVocabEnrichStore((s) => s.bulk);
  const bulkRunning = bulk.running;
  const bulkProgress = { done: bulk.done, total: bulk.total };
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false);

  const runBulkEnrich = async (targets: WordListItem[]) => {
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }
    if (targets.length === 0) {
      toast.info(t("vocab.bulkEnrichNoneNeeded"));
      return;
    }

    const controller = useVocabEnrichStore.getState().startBulk(targets.length);

    let succeeded = 0;
    let failed = 0;
    let done = 0;
    let nextIndex = 0;

    const processWord = async (w: WordListItem) => {
      // If this word's detail panel happens to be open, clear its stale
      // explanation and show the loading state while its turn runs. Only
      // the open word streams into the panel — the other in-flight words
      // just persist quietly.
      const isOpen = selectedRef.current?.word.id === w.id;
      if (isOpen) {
        setEnriching(true);
        setSelected((prev) => prev ? { ...prev, enriched: null, legacy: false } : prev);
      }
      try {
        const [raw, basicInfo] = await Promise.all([
          (async () => {
            let acc = "";
            for await (const chunk of provider.enrich(w.word, controller.signal)) {
              if (controller.signal.aborted) break;
              acc += chunk;
              if (isOpen) {
                const parsed = parseEnrichmentStream(acc);
                setSelected((prev) => prev && prev.word.id === w.id ? { ...prev, enriched: parsed } : prev);
              }
            }
            return acc;
          })(),
          fetchBasicInfo(provider, w.word, targetLevel, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const final = parseEnrichmentStream(raw);
        const zhShort = basicInfo.zh || final.zhShort;
        const level = basicInfo.level || final.level;
        await db.addWordEnriched(w.word, zhShort || w.word, basicInfo.wordType || null, {
          text: final.text,
          zhShort,
          level,
        });
        setWords((prev) => prev.map((x) => x.id === w.id
          ? { ...x, zh: zhShort || x.zh, level: level || x.level, word_type: basicInfo.wordType || x.word_type }
          : x));
        if (isOpen) {
          setSelected((prev) => prev && prev.word.id === w.id
            ? { ...prev, enriched: final, word: { ...prev.word, zh: zhShort || prev.word.zh, level: level || prev.word.level, word_type: basicInfo.wordType || prev.word.word_type } }
            : prev);
        }
        succeeded++;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        failed++;
      } finally {
        done++;
        useVocabEnrichStore.getState().setBulkProgress(done);
        if (isOpen) setEnriching(false);
      }
    };

    // Small worker pool: a few words in flight at once cuts wall time without
    // hammering the provider's rate limits. Workers pull the next word off a
    // shared cursor; aborting stops every worker at its next word boundary
    // (in-flight streams are cancelled through the shared signal).
    const workers = Array.from({ length: Math.min(BULK_CONCURRENCY, targets.length) }, async () => {
      while (!controller.signal.aborted) {
        const i = nextIndex++;
        if (i >= targets.length) break;
        await processWord(targets[i]);
      }
    });
    await Promise.all(workers);

    const aborted = controller.signal.aborted;
    useVocabEnrichStore.getState().finishBulk();
    loadWords();
    loadAllWordsSet();
    if (succeeded > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    if (!aborted) {
      toast.success(
        t("vocab.bulkEnrichDone", { done: succeeded }) +
          (failed > 0 ? t("vocab.bulkEnrichFailedSuffix", { failed }) : "")
      );
    }
  };

  const enrichUnanalyzed = async () => {
    if (bulkRunning) return;
    const all = await db.getWords();
    runBulkEnrich(all.filter((w) => !w.enriched));
  };

  const reanalyzeAll = async () => {
    setReanalyzeConfirmOpen(false);
    if (bulkRunning) return;
    const all = await db.getWords();
    runBulkEnrich(all);
  };

  const stopBulkEnrich = () => useVocabEnrichStore.getState().bulk.controller?.abort();

  return {
    bulkRunning, bulkProgress,
    reanalyzeConfirmOpen, setReanalyzeConfirmOpen,
    runBulkEnrich, enrichUnanalyzed, reanalyzeAll, stopBulkEnrich,
  };
}
