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
  loadAllWordsStats: () => Promise<void>;
}) {
  const { db, targetLevel, setWords, selectedRef, setSelected, setEnriching, loadWords, loadAllWordsStats } = params;
  const t = useT();

  const bulk = useVocabEnrichStore((s) => s.bulk);
  const bulkRunning = bulk.running;
  const bulkProgress = { done: bulk.done, total: bulk.total };
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false);

  const runBulkEnrich = async (targets: { id: number; word: string }[]) => {
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

    const processWord = async (w: { id: number; word: string }) => {
      // If this word's detail panel happens to be open, clear its stale
      // explanation and show the loading state while its turn runs. Only
      // the open word streams into the panel — the other in-flight words
      // just persist quietly. The old explanation is captured first so a
      // refused write (or a thrown stream) can restore it — the panel must
      // never end up blank while the database still holds good content.
      const isOpen = selectedRef.current?.word.id === w.id;
      const prevEnriched = isOpen ? selectedRef.current?.enriched ?? null : null;
      const restorePanel = () => {
        if (isOpen) {
          setSelected((prev) => prev && prev.word.id === w.id
            ? { ...prev, enriched: prevEnriched, legacy: prevEnriched ? false : prev.legacy }
            : prev);
        }
      };
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
        // `zh` is only a fallback for words that have no gloss at all — the
        // Rust layer keeps any existing gloss, so passing the English word
        // itself here can never overwrite a good Chinese gloss. The wrapper
        // never throws: a failed write (e.g. the Rust guard refusing an
        // empty-over-good overwrite) comes back as { id: 0 }.
        const saved = await db.addWordEnriched(w.word, zhShort || w.word, basicInfo.wordType || null, {
          text: final.text,
          zhShort,
          level,
        }, basicInfo.scenes);
        if (!saved || saved.id === 0) {
          // Write refused (e.g. empty explanation over an existing good
          // one) — keep the word's old analysis, count as failed, keep
          // processing the rest. Restore the panel to its old content: the
          // DB still holds it, so showing blank would be a lie.
          failed++;
          restorePanel();
          return;
        }
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
        // stream threw mid-flight: the DB still holds the old analysis, so
        // put it back in the panel instead of leaving it blank
        restorePanel();
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
    loadAllWordsStats();
    if (succeeded > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    if (!aborted) {
      toast.success(
        t("vocab.bulkEnrichDone", { done: succeeded }) +
          (failed > 0 ? t("vocab.bulkEnrichFailedSuffix", { failed }) : "")
      );
    }
  };

  // Bulk targets need only (id, word) — the light projection keeps a 10k
  // library from paying the full-list dump (216ms + a ~1.5MB IPC payload at
  // that size) every time these buttons are clicked.
  const enrichUnanalyzed = async () => {
    if (bulkRunning) return;
    const ids = await db.listWordIds(true);
    runBulkEnrich(ids);
  };

  const reanalyzeAll = async () => {
    setReanalyzeConfirmOpen(false);
    if (bulkRunning) return;
    const ids = await db.listWordIds(false);
    runBulkEnrich(ids);
  };

  const stopBulkEnrich = () => useVocabEnrichStore.getState().bulk.controller?.abort();

  return {
    bulkRunning, bulkProgress,
    reanalyzeConfirmOpen, setReanalyzeConfirmOpen,
    runBulkEnrich, enrichUnanalyzed, reanalyzeAll, stopBulkEnrich,
  };
}
