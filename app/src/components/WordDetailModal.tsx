import React, { useState, useEffect } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWordModalStore } from "@/store/wordModalStore";
import { findBestProvider } from "@/providers/select";
import { WordEnrichment } from "@/providers/base";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { FloatingChatButton } from "@/components/WordChatPanel";
import {
  LoadingSkeleton,
  ErrorState,
  EnrichmentContent,
} from "@/components/WordDetailContent";

export function WordDetailModal() {
  const { word, closeWordModal } = useWordModalStore();
  const db = useDB();
  const t = useT();
  const [data, setData] = useState<Partial<WordEnrichment> | null>(null);
  const [pendingSlices, setPendingSlices] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [wordId, setWordId] = useState<number | null>(null);

  useEffect(() => {
    if (!word) return;
    setData(null);
    setPendingSlices(0);
    setError(null);
    setAdded(false);
    setWordId(null);
    setLoading(true);

    const controller = new AbortController();

    const runAiEnrich = async (w: string) => {
      const provider = findBestProvider();
      if (!provider || !provider.apiKey) {
        setError(t("modal.noProvider"));
        setLoading(false);
        return;
      }
      setData({});
      setLoading(false);
      setPendingSlices(4);
      try {
        for await (const partial of provider.enrich(w, controller.signal)) {
          if (controller.signal.aborted) break;
          setData((prev) => ({ ...prev, ...partial }));
          setPendingSlices((prev) => prev - 1);
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setData((prev) =>
          prev && Object.keys(prev).length > 0
            ? prev
            : {
                definitions: [{ pos: "other", zh: w, en: w, exampleEn: "", exampleZh: "" }],
                synonyms: [], antonyms: [], collocations: [],
                derivatives: [], sentencePatterns: [], idioms: [],
                authorityQuotes: [],
                etymology: { parts: [], story: "", originLang: "" },
                level: "B2", mnemonic: "",
              }
        );
        setPendingSlices(0);
      }
    };

    db.getWordDetailByWord(word)
      .then((localDetail) => {
        if (localDetail?.id) setWordId(localDetail.id);
        if (localDetail && localDetail.enrichment_json) {
          try {
            const stored = JSON.parse(localDetail.enrichment_json);
            const enrichment: Partial<WordEnrichment> = {
              definitions: (stored.definitions || localDetail.definitions).map((d: any) => ({
                pos: d.pos,
                zh: d.zh,
                en: d.en || d.exampleEn || "",
                exampleEn: d.example_en || d.exampleEn || "",
                exampleZh: d.example_zh || d.exampleZh || "",
              })),
              synonyms: stored.synonyms || [],
              antonyms: stored.antonyms || [],
              collocations: stored.collocations || [],
              derivatives: stored.derivatives || [],
              sentencePatterns: stored.sentence_patterns || stored.sentencePatterns || [],
              idioms: stored.idioms || [],
              authorityQuotes: stored.authority_quotes || stored.authorityQuotes || [],
              etymology: stored.etymology
                ? {
                    parts: Array.isArray(stored.etymology.parts)
                      ? stored.etymology.parts
                      : (() => { try { return JSON.parse(stored.etymology.parts || "[]"); } catch { return []; } })(),
                    story: stored.etymology.story || "",
                    originLang: stored.etymology.origin_lang || stored.etymology.originLang || "",
                  }
                : { parts: [], story: "", originLang: "" },
              level: (stored.level || localDetail.level || "B2") as any,
              mnemonic: stored.mnemonic || localDetail.mnemonic || "",
            };
            setData(enrichment);
            setLoading(false);
            return true;
          } catch {}
        }
        return false;
      })
      .then((foundInDb) => {
        if (!foundInDb && word) runAiEnrich(word);
      })
      .catch(() => { if (word) runAiEnrich(word); });

    return () => controller.abort();
  }, [word]);

  const handleAddToVocabulary = async () => {
    if (!word || !data) return;
    try {
      const result = await db.addWordEnriched(
        word,
        data.definitions?.[0]?.zh || word,
        data.definitions?.[0]?.pos || null,
        {
          definitions: data.definitions || [],
          synonyms: data.synonyms || [],
          antonyms: data.antonyms || [],
          collocations: data.collocations || [],
          derivatives: (data.derivatives || []).map((d) => ({ word: d.word, wordType: d.wordType, zh: d.zh })),
          sentencePatterns: data.sentencePatterns || [],
          idioms: data.idioms || [],
          authorityQuotes: data.authorityQuotes || [],
          etymology: data.etymology?.parts?.length
            ? {
                parts: data.etymology.parts.map((p) => ({ seg: p.seg, role: p.role, meaning: p.meaning })),
                story: data.etymology.story,
                originLang: data.etymology.originLang,
              }
            : undefined,
          level: data.level,
          mnemonic: data.mnemonic,
        }
      );
      setAdded(true);
      if (result.isNew) {
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(`「${word}」已添加到词库`);
      } else {
        toast.info(`「${word}」已在词库中`);
      }
    } catch {
      toast.error("添加失败，请重试");
    }
  };

  const enrichedContextStr = data && Object.keys(data).length > 0 ? JSON.stringify({
    definitions: data.definitions?.slice(0, 3),
    synonyms: data.synonyms?.slice(0, 4),
    level: data.level,
    etymology: data.etymology,
    mnemonic: data.mnemonic,
  }) : "";

  return (
    <Dialog open={!!word} onClose={closeWordModal} maxWidth="max-w-xl">
      <div className="relative">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("modal.wordDetail")}</span>
          <div className="flex items-center gap-2">
            {data && pendingSlices === 0 && (
              <Button onClick={handleAddToVocabulary} disabled={added} size="sm" className="h-7 text-xs px-3">
                {added ? t("modal.added") : t("modal.addToVocab")}
              </Button>
            )}
            <button
              onClick={closeWordModal}
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-sm"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-6 max-h-[78vh] overflow-y-auto">
          {loading && <LoadingSkeleton t={t} />}
          {error && !loading && <ErrorState message={error} t={t} />}
          {data && !loading && (
            <EnrichmentContent
              data={data}
              word={word!}
              t={t}
              pendingSlices={pendingSlices}
            />
          )}
        </div>

        {word && (
          <FloatingChatButton
            wordId={wordId}
            word={word}
            enrichedContext={enrichedContextStr}
            insideModal
          />
        )}
      </div>
    </Dialog>
  );
}
