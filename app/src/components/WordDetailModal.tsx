import React, { useState, useEffect, useCallback } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWordModalStore } from "@/store/wordModalStore";
import { findBestProvider } from "@/providers/select";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { LoadingSkeleton, ErrorState } from "@/components/WordDetailContent";
import { EnrichmentText } from "@/components/EnrichmentText";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";
import { CloseIcon } from "@/components/ui/icons";

export function WordDetailModal() {
  const { word, closeWordModal } = useWordModalStore();
  const db = useDB();
  const t = useT();
  const [parsed, setParsed] = useState<ParsedEnrichment | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [added, setAdded] = useState(false);

  const runAiEnrich = useCallback(async (w: string, signal?: AbortSignal) => {
    const provider = findBestProvider();
    if (!provider || !provider.apiKey) {
      setError(t("modal.noProvider"));
      setLoading(false);
      return;
    }
    setLegacy(false);
    setError(null);
    setLoading(false);
    setStreaming(true);
    let raw = "";
    try {
      for await (const chunk of provider.enrich(w, signal)) {
        if (signal?.aborted) break;
        raw += chunk;
        setParsed(parseEnrichmentStream(raw));
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (!raw) setError(t("modal.noProvider"));
    } finally {
      setStreaming(false);
    }
  }, [t]);

  useEffect(() => {
    if (!word) return;
    setParsed(null);
    setStreaming(false);
    setError(null);
    setLegacy(false);
    setAdded(false);
    setLoading(true);

    const controller = new AbortController();

    db.getWordDetailByWord(word)
      .then((localDetail) => {
        if (localDetail?.enrichment_text) {
          setParsed({
            text: localDetail.enrichment_text,
            level: localDetail.level ?? undefined,
            zhShort: localDetail.definitions?.[0]?.zh,
          });
          setLoading(false);
          return true;
        }
        if (localDetail?.enrichment_json) {
          setLegacy(true);
          setLoading(false);
          return true;
        }
        return false;
      })
      .then((foundInDb) => {
        if (!foundInDb && word) runAiEnrich(word, controller.signal);
      })
      .catch(() => { if (word) runAiEnrich(word, controller.signal); });

    return () => controller.abort();
  }, [word, runAiEnrich]);

  const handleAddToVocabulary = async () => {
    if (!word || !parsed) return;
    try {
      const result = await db.addWordEnriched(word, parsed.zhShort || word, null, {
        text: parsed.text,
        zhShort: parsed.zhShort,
        level: parsed.level,
      });
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

  return (
    <Dialog open={!!word} onClose={closeWordModal} maxWidth="max-w-xl">
      <div className="relative">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("modal.wordDetail")}</span>
          <div className="flex items-center gap-2">
            {parsed && !streaming && (
              <Button onClick={handleAddToVocabulary} disabled={added} size="sm" className="h-7 text-xs px-3">
                {added ? t("modal.added") : t("modal.addToVocab")}
              </Button>
            )}
            <button
              onClick={closeWordModal}
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-6 max-h-[78vh] overflow-y-auto">
          {loading && <LoadingSkeleton t={t} />}
          {error && !loading && <ErrorState message={error} t={t} />}
          {legacy && !loading && (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-muted-foreground">{t("modal.legacyEnrichment")}</p>
              <Button onClick={() => word && runAiEnrich(word)} size="sm" variant="secondary">{t("vocab.reenrich")}</Button>
            </div>
          )}
          {parsed && !loading && !legacy && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold">{word}</h2>
                {parsed.level && <Badge variant="default" className="text-xs">{parsed.level}</Badge>}
              </div>
              <EnrichmentText text={parsed.text} />
              {streaming && <p className="text-xs text-muted-foreground animate-pulse">{t("modal.fetching")}</p>}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
