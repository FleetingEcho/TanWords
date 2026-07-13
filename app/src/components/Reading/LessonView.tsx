import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useDB, ArticleDetail, ExtractedItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SentenceParagraph, ParagraphSentence } from "./SentenceParagraph";
import { splitSentences } from "@/lib/sentences";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { SpeakerIcon, FeedIcon, SparkIcon, RefreshIcon } from "@/components/ui/icons";
import { CheckIcon } from "@heroicons/react/24/solid";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";
import { WordSearchBox } from "./WordSearchBox";

const PATTERN_HIGHLIGHT_KEY = "tanwords_pattern_highlight";

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

function ItemCard({
  item,
  onAction,
  flash,
  innerRef,
}: {
  item: ExtractedItem;
  onAction: (item: ExtractedItem, action: "accept" | "know" | "dismiss" | "reset") => void;
  flash: boolean;
  innerRef: (el: HTMLDivElement | null) => void;
}) {
  const t = useT();
  const dimmed = item.status === "dismissed" || item.status === "known";

  return (
    <div
      ref={innerRef}
      className={`px-4 py-3 space-y-1.5 transition-all ${flash ? "ring-2 ring-primary/50 bg-primary/5" : ""} ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-primary">
          {item.text}
        </span>
        <SpeakButton text={item.text} className="w-3.5 h-3.5" />
        <LevelBadge level={item.level} />
        <span className="text-xs text-muted-foreground truncate">{item.zh}</span>
      </div>
      {item.note && <p className="text-xs text-muted-foreground leading-relaxed">{item.note}</p>}
      {item.context_sentence && (
        <p className="text-xs text-muted-foreground/70 italic leading-relaxed line-clamp-2 flex items-start gap-1">
          <span>“{item.context_sentence}”</span>
          <SpeakButton text={item.context_sentence} className="w-3 h-3 mt-0.5 shrink-0" />
        </p>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        {item.status === "candidate" && (
          <>
            <button
              onClick={() => onAction(item, "accept")}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              {t("reading.addToVocab")}
            </button>
            <button
              onClick={() => onAction(item, "know")}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("reading.know")}
            </button>
            <button
              onClick={() => onAction(item, "dismiss")}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("reading.dismiss")}
            </button>
          </>
        )}
        {item.status === "accepted" && (
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5">
            <CheckIcon className="w-3 h-3" /> {t("reading.added")}
          </span>
        )}
        {item.status === "known" && (
          <button
            onClick={() => onAction(item, "reset")}
            className="text-[11px] text-muted-foreground hover:text-foreground"
            title={t("reading.undo")}
          >
            {t("reading.knownChip")}
          </button>
        )}
        {item.status === "dismissed" && (
          <button
            onClick={() => onAction(item, "reset")}
            className="text-[11px] text-muted-foreground hover:text-foreground"
            title={t("reading.undo")}
          >
            {t("reading.dismissedChip")}
          </button>
        )}
      </div>
    </div>
  );
}

export function LessonView({ articleId, onBack, onDeleted, onReanalyzed }: Props) {
  const db = useDB();
  const t = useT();
  const { analyze, isAnalyzing } = useAnalyzeArticle();
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [highlightPatterns, setHighlightPatterns] = useState(
    () => localStorage.getItem(PATTERN_HIGHLIGHT_KEY) !== "0"
  );
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
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

  const jumpToItem = useCallback((id: number) => {
    const el = cardRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(id);
      setTimeout(() => setFlashId(null), 1200);
    }
  }, []);

  const setStatus = (id: number, status: ExtractedItem["status"]) => {
    setArticle((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it) => (it.id === id ? { ...it, status } : it)) }
        : prev
    );
  };

  const handleAction = async (
    item: ExtractedItem,
    action: "accept" | "know" | "dismiss" | "reset"
  ) => {
    try {
      if (action === "accept") {
        await db.addWord(item.text, item.zh, undefined, item.level || undefined);
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        await db.updateItemStatus(item.id, "accepted");
        setStatus(item.id, "accepted");
      } else if (action === "know") {
        await db.addKnownWords([item.text], "marked");
        await db.updateItemStatus(item.id, "known");
        setStatus(item.id, "known");
      } else if (action === "dismiss") {
        await db.updateItemStatus(item.id, "dismissed");
        setStatus(item.id, "dismissed");
      } else {
        await db.updateItemStatus(item.id, "candidate");
        setStatus(item.id, "candidate");
      }
    } catch {
      toast.error(t("reading.toast.actionFailed"));
    }
  };

  const handleAddAll = async () => {
    if (!article) return;
    const candidates = article.items.filter((it) => it.kind === "word" && it.status === "candidate");
    if (candidates.length === 0) return;
    try {
      for (const it of candidates) {
        await db.addWord(it.text, it.zh, undefined, it.level || undefined);
        await db.updateItemStatus(it.id, "accepted");
        setStatus(it.id, "accepted");
      }
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(t("reading.toast.addedAll", { n: candidates.length }));
    } catch {
      toast.error(t("reading.toast.actionFailed"));
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
      toast.success(t("reading.toast.analyzed", { n: result.itemCount }), { id: toastId });
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
        <button onClick={onBack} className="text-xs font-semibold text-primary hover:underline">
          ← {t("reading.back")}
        </button>
      </div>
    );
  }

  const words = article.items.filter((it) => it.kind === "word");
  const sentenceItems = article.items.filter((it) => it.kind === "sentence");
  const pendingWords = words.filter((it) => it.status === "candidate").length;

  const togglePatterns = () => {
    setHighlightPatterns((prev) => {
      localStorage.setItem(PATTERN_HIGHLIGHT_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  return (
    <div className="space-y-4">
      {/* Lesson header — sticky so Back/Listen/Add-all stay reachable while
        * reading a long article. Negative margins swallow the page wrapper's
        * p-6 so the bar spans (and its backdrop covers) the full width. */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 px-6 pt-4 pb-3 bg-background/95 backdrop-blur-sm border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            ← {t("reading.back")}
          </button>
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
              <button onClick={openSource} className="text-primary hover:underline">
                {t("reading.openSource")}
              </button>
            )}
            <span>{article.created_at.slice(0, 16)}</span>
            <button onClick={handleDelete} className="text-muted-foreground/60 hover:text-destructive transition-colors">
              {t("reading.delete")}
            </button>
          </div>
        </div>
        <div className="flex gap-3">
          <button
          onClick={() => setConfirmReanalyze(true)}
          disabled={isAnalyzing}
          title={t("reading.reanalyze")}
          className="w-8 h-8 rounded-lg border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors shrink-0"
        >
          <RefreshIcon className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
        </button>
        {sentenceItems.length > 0 && (
          <button
            onClick={togglePatterns}
            title={t("reading.patternToggleHint")}
            className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors ${
              highlightPatterns
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <SparkIcon className="w-3.5 h-3.5" />
            {t("reading.patternToggle")}
          </button>
        )}
        <button
          onClick={handleListenToArticle}
          className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors ${
            playerActive
              ? "bg-primary/10 text-primary"
              : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <SpeakerIcon className="w-3.5 h-3.5" />
          {t("tts.listenToArticle")}
        </button>
        {pendingWords > 0 && (
          <button
            onClick={handleAddAll}
            className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          >
            {t("reading.addAll", { n: pendingWords })}
          </button>
        )}
        </div>
      </div>

      {/* Two-column lesson */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4 items-start">
        {/* Article body — extracted words highlighted, click-to-jump when playing */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          {paragraphChunks.map((chunk, i) => {
            const chunkSentences: ParagraphSentence[] = articleSentences
              .map((s, globalIndex) => ({ s, globalIndex }))
              .filter(({ s }) => s.start >= chunk.start && s.start < chunk.end)
              .map(({ s, globalIndex }) => ({ text: s.text, globalIndex }));
            return (
              <SentenceParagraph
                key={i}
                sentences={chunkSentences}
                items={words}
                sentenceItems={highlightPatterns ? sentenceItems : []}
                onJump={jumpToItem}
                playerActive={playerActive}
                playerCurrentIndex={playerCurrentIndex}
                onPlayerJump={playerJumpTo}
                registerSpanRef={registerSpanRef}
              />
            );
          })}
        </div>

        {/* Extracted items panel */}
        {/* top offset clears the sticky lesson header above (≤2-line title) */}
        <div className="space-y-4 lg:sticky lg:top-36 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
          <WordSearchBox />
          {article.items.length === 0 && (
            <div className="bg-card border border-border rounded-2xl p-6 text-center text-xs text-muted-foreground">
              {t("reading.noItems")}
            </div>
          )}
          {words.length > 0 && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-xs font-semibold">{t("reading.words")}</span>
                <span className="text-[11px] font-mono text-muted-foreground">{words.length}</span>
              </div>
              <div className="divide-y divide-border">
                {words.map((it) => (
                  <ItemCard
                    key={it.id}
                    item={it}
                    onAction={handleAction}
                    flash={flashId === it.id}
                    innerRef={(el) => { if (el) cardRefs.current.set(it.id, el); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Highlight sentences / reusable patterns */}
          {sentenceItems.length > 0 && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold">{t("reading.patterns")}</span>
                <span className="text-[11px] font-mono text-muted-foreground">{sentenceItems.length}</span>
              </div>
              <div className="divide-y divide-border">
                {sentenceItems.map((it) => (
                  <div
                    key={it.id}
                    ref={(el) => { if (el) cardRefs.current.set(it.id, el); }}
                    className={`px-4 py-3 space-y-1.5 transition-all ${
                      flashId === it.id ? "ring-2 ring-amber-500/50 bg-amber-500/5" : ""
                    }`}
                  >
                    <p className="text-[13px] font-serif italic leading-relaxed text-foreground flex items-start gap-1">
                      <span>“{it.text}”</span>
                      <SpeakButton text={it.text} className="w-3 h-3 mt-1 shrink-0" />
                    </p>
                    {it.context_sentence && (
                      <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
                        {it.context_sentence}
                      </p>
                    )}
                    {it.zh && <p className="text-xs text-muted-foreground">{it.zh}</p>}
                    {it.note && <p className="text-xs text-muted-foreground/80 leading-relaxed">{it.note}</p>}
                  </div>
                ))}
              </div>
            </div>
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
    </div>
  );
}
