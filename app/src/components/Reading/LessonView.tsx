import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useDB, ArticleDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { SentenceParagraph, ParagraphSentence } from "./SentenceParagraph";
import { splitSentences } from "@/lib/sentences";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { SpeakerIcon, FeedIcon, RefreshIcon, TranslateIcon, SearchIcon, PinIcon } from "@/components/ui/icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";
import { WordSearchBox } from "./WordSearchBox";
import { SaveSentenceBox } from "./SaveSentenceBox";
import { TranslateModal } from "./TranslateModal";
import { Markdown } from "@/components/AiChat/Markdown";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

interface Props {
  articleId: number;
  onBack: () => void;
  onDeleted: () => void;
  /** Called with the replacement article id after a successful re-analysis. */
  onReanalyzed: (newArticleId: number) => void;
}

interface ParagraphChunk {
  start: number;
  end: number;
}

/** Same paragraph boundaries as the old `content.split(/\n+/)`, but keeping
 * each chunk's offset into the original text so article-wide sentence
 * indices (from `splitSentences`) can be assigned to the paragraph they
 * fall in. */
function splitParagraphsWithOffsets(content: string): ParagraphChunk[] {
  const chunks: ParagraphChunk[] = [];
  const re = /\n+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (content.slice(last, m.index).trim()) chunks.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  if (content.slice(last).trim()) chunks.push({ start: last, end: content.length });
  return chunks;
}

export function LessonView({ articleId, onBack, onDeleted, onReanalyzed }: Props) {
  const db = useDB();
  const t = useT();
  const { analyze, isAnalyzing } = useAnalyzeArticle();
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const sentenceSpanRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

  const sourceKey = `lesson-${articleId}`;
  const playerSourceKey = useTtsPlayerStore((s) => s.sourceKey);
  const playerCurrentIndex = useTtsPlayerStore((s) => s.currentIndex);
  const playerStart = useTtsPlayerStore((s) => s.start);
  const playerJumpTo = useTtsPlayerStore((s) => s.jumpTo);
  const playerToggle = useTtsPlayerStore((s) => s.toggle);
  const playerActive = playerSourceKey === sourceKey;

  useEffect(() => {
    setLoading(true);
    db.getArticle(articleId)
      // Strip footnote back-reference glyphs (↩︎) that older fetches stored
      // before the extractor started cleaning them at the source.
      .then((a) => setArticle(a && { ...a, content: a.content.replace(/[↩︎️]/g, "") }))
      .finally(() => setLoading(false));
  }, [articleId]);

  const articleSentences = useMemo(
    () => (article ? splitSentences(article.content) : []),
    [article?.content]
  );
  const paragraphChunks = useMemo(
    () => (article ? splitParagraphsWithOffsets(article.content) : []),
    [article?.content]
  );

  const registerSpanRef = useCallback((globalIndex: number, el: HTMLSpanElement | null) => {
    if (el) sentenceSpanRefs.current.set(globalIndex, el);
    else sentenceSpanRefs.current.delete(globalIndex);
  }, []);

  useEffect(() => {
    if (!playerActive) return;
    const el = sentenceSpanRefs.current.get(playerCurrentIndex);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [playerActive, playerCurrentIndex]);

  const handleListenToArticle = () => {
    if (!article) return;
    if (playerActive) playerToggle();
    else {
      playerStart(sourceKey, article.content);
      usePlayerOriginStore.getState().setOrigin({ kind: "lesson", articleId });
    }
  };

  /** Re-run the AI analysis on the same text. Creates the replacement article
   * first and only deletes the old one on success, so a failed run loses
   * nothing. Words already accepted into vocabulary are auto-excluded by the
   * analyzer, so a re-run surfaces fresh material. */
  const handleReanalyze = async () => {
    if (!article || isAnalyzing) return;
    const toastId = toast.loading(t("reading.analyzing"));
    try {
      const result = await analyze({
        text: article.content,
        title: article.title,
        sourceUrl: article.source_url || undefined,
        origin: article.origin,
      });
      await db.deleteArticle(articleId);
      toast.success(t("reading.toast.analyzed"), { id: toastId });
      onReanalyzed(result.articleId);
    } catch (e: any) {
      toast.error(e.message || t("reading.toast.failed"), { id: toastId });
    }
  };

  const handleDelete = async () => {
    try {
      await db.deleteArticle(articleId);
      toast.success(t("reading.toast.deleted"));
      onDeleted();
    } catch {
      toast.error(t("reading.toast.actionFailed"));
    }
  };

  const openSource = async () => {
    if (!article?.source_url) return;
    try {
      await openShell(article.source_url);
    } catch {
      window.open(article.source_url, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <span className="text-xs text-muted-foreground animate-pulse">…</span>
      </div>
    );
  }
  if (!article) {
    return (
      <div className="py-20 flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">{t("reading.notFound")}</p>
        <Button variant="link" onClick={onBack} className="h-auto p-0 text-xs font-semibold text-primary hover:underline">
          ← {t("reading.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Lesson header — sticky so Back/Listen/Add-all stay reachable while
        * reading a long article. Negative margins swallow the page wrapper's
        * p-6 so the bar spans (and its backdrop covers) the full width. */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 px-6 pt-4 pb-3 bg-background/95 backdrop-blur-sm border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button
            variant="link"
            onClick={onBack}
            className="h-auto p-0 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            ← {t("reading.back")}
          </Button>
          <h2 className="text-xl font-bold leading-snug mt-1 line-clamp-2">{article.title}</h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {article.origin === "hackernews" && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-sm bg-orange-500 text-white text-[8px] font-bold flex items-center justify-center">Y</span>
                Hacker News
              </span>
            )}
            {article.origin === "rss" && (
              <span className="inline-flex items-center gap-1">
                <FeedIcon className="w-3.5 h-3.5 text-primary" />
                {t("feeds.title")}
              </span>
            )}
            {article.source_url && (
              <Button variant="link" onClick={openSource} className="h-auto p-0 text-primary hover:underline">
                {t("reading.openSource")}
              </Button>
            )}
            <span>{article.created_at.slice(0, 16)}</span>
            <Button variant="link" onClick={handleDelete} className="h-auto p-0 text-muted-foreground/60 hover:text-destructive transition-colors">
              {t("reading.delete")}
            </Button>
          </div>
        </div>
        <div className="flex gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                title={t("reading.search.title")}
                className="w-8 h-8 p-0 rounded-lg border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <SearchIcon className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <WordSearchBox />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                title={t("reading.saveSentence.title")}
                className="w-8 h-8 p-0 rounded-lg border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <PinIcon className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3 max-h-[70vh] overflow-y-auto">
              <SaveSentenceBox articleId={article.id} articleTitle={article.title} />
            </PopoverContent>
          </Popover>
          <Button
          variant="outline"
          onClick={() => setConfirmReanalyze(true)}
          disabled={isAnalyzing}
          title={t("reading.reanalyze")}
          className="w-8 h-8 p-0 rounded-lg border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors shrink-0"
        >
          <RefreshIcon className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="outline"
          onClick={() => setTranslateOpen(true)}
          title={t("reading.translate.button")}
          className="w-8 h-8 p-0 rounded-lg border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <TranslateIcon className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          onClick={handleListenToArticle}
          className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors ${
            playerActive
              ? "bg-primary/10 text-primary hover:bg-primary/10"
              : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <SpeakerIcon className="w-3.5 h-3.5" />
          {t("tts.listenToArticle")}
        </Button>
        </div>
      </div>

      {/* Two-column lesson, split evenly — article prose is capped at a
        * readable measure internally so it doesn't stretch into long lines
        * as this column grows on wide screens. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Article body — click-to-jump when playing */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="max-w-[75ch] space-y-4">
            {paragraphChunks.map((chunk, i) => {
              const chunkSentences: ParagraphSentence[] = articleSentences
                .map((s, globalIndex) => ({ s, globalIndex }))
                .filter(({ s }) => s.start >= chunk.start && s.start < chunk.end)
                .map(({ s, globalIndex }) => ({ text: s.text, globalIndex }));
              return (
                <SentenceParagraph
                  key={i}
                  sentences={chunkSentences}
                  playerActive={playerActive}
                  playerCurrentIndex={playerCurrentIndex}
                  onPlayerJump={playerJumpTo}
                  registerSpanRef={registerSpanRef}
                />
              );
            })}
          </div>
        </div>

        {/* AI notes — the search/save tools moved up into the sticky header
          * bar (with Reanalyze/Translate/Listen), so this column is free to
          * be entirely notes. Sticky + internally scrollable so it fills the
          * viewport rather than pushing the page's own scrollbar. */}
        {/* top offset clears the sticky lesson header above (≤2-line title) */}
        <div className="bg-card border border-border rounded-2xl p-4 lg:sticky lg:top-36 lg:max-h-[calc(100vh-10rem)] overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-xs font-semibold">{t("reading.notesTitle")}</span>
          </div>
          {article.analysis_markdown.trim() ? (
            <Markdown text={article.analysis_markdown} />
          ) : (
            <p className="text-xs text-muted-foreground">{t("reading.notesEmpty")}</p>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmReanalyze}
        title={t("reading.reanalyze")}
        message={t("reading.reanalyzeConfirm")}
        confirmLabel={t("reading.reanalyze")}
        onCancel={() => setConfirmReanalyze(false)}
        onConfirm={() => {
          setConfirmReanalyze(false);
          handleReanalyze();
        }}
      />

      <TranslateModal
        open={translateOpen}
        onClose={() => setTranslateOpen(false)}
        title={article.title}
        articleText={article.content}
      />
    </div>
  );
}
