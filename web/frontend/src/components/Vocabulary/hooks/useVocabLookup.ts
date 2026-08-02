import { useDB } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { parseEnrichmentStream } from "@/lib/enrichMeta";
import { fetchBasicInfo } from "@/lib/basicInfo";
import type { LookupData, SelectedWordData } from "./useVocabWordDetail";

/** Dictionary behavior for a word that isn't (yet) in the vocabulary: an AI
 * lookup shown in the same detail panel, with an explicit "add to vocab"
 * step rather than being saved automatically. */
export function useVocabLookup(params: {
  db: ReturnType<typeof useDB>;
  targetLevel: string;
  enriching: boolean;
  lookup: LookupData | null;
  setLookup: React.Dispatch<React.SetStateAction<LookupData | null>>;
  setSelected: React.Dispatch<React.SetStateAction<SelectedWordData | null>>;
  setEnriching: React.Dispatch<React.SetStateAction<boolean>>;
  setEnrichError: React.Dispatch<React.SetStateAction<string>>;
  lookupControllerRef: React.MutableRefObject<AbortController | null>;
}) {
  const {
    db, targetLevel, enriching, lookup, setLookup, setSelected, setEnriching, setEnrichError, lookupControllerRef,
  } = params;
  const t = useT();

  const startLookup = async (query: string) => {
    const word = query.trim();
    if (!word || enriching) return;

    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("vocab.noApiKey"));
      return;
    }

    lookupControllerRef.current?.abort();
    const controller = new AbortController();
    lookupControllerRef.current = controller;

    setSelected(null);
    setLookup({ word, enriched: null, basicInfo: {}, added: false, wordId: null });
    setEnriching(true);
    setEnrichError("");

    let raw = "";
    try {
      fetchBasicInfo(provider, word, targetLevel, controller.signal).then((basicInfo) => {
        setLookup((prev) => prev?.word === word ? { ...prev, basicInfo } : prev);
      });
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
      const zhShort = lookup.basicInfo.zh || lookup.enriched.zhShort;
      const result = await db.addWordEnriched(lookup.word, zhShort || lookup.word, lookup.basicInfo.wordType || null, {
        text: lookup.enriched.text,
        zhShort,
        level: lookup.basicInfo.level || lookup.enriched.level,
      });
      setLookup((prev) => prev ? { ...prev, added: true, wordId: result.id } : prev);
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(`「${lookup.word}」已加入词库`);
    } catch {
      toast.error(t("vocab.aiError"));
    }
  };

  return { startLookup, addLookupToVocab };
}
