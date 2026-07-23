import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useDB, ArticleDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { SentenceParagraph, ParagraphSentence } from "./SentenceParagraph";
import { splitSentences } from "@/lib/sentences";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { SpeakerIcon, FeedIcon, RefreshIcon, TranslateIcon, SearchIcon, BookmarkIcon, ChevronIcon } from "@/components/ui/icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";
import { HnComments } from "@/components/Reader/HnComments";
import { TranslationPane } from "./TranslationPane";
import { WordSearchBox } from "./WordSearchBox";
import { SaveSentenceBox } from "./SaveSentenceBox";
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

type PaneKey = "article" | "notes" | "translation";

/** Collapsed panes shrink to this fixed-width strip (title + expand chevron)
 *  instead of participating in the flex-weight split below. */
function CollapsedPaneStrip({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      title={label}
      className="shrink-0 w-9 flex flex-col items-center gap-2 py-3 rounded-2xl border border-border bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors lg:sticky lg:top-36"
    >
      <ChevronIcon direction="right" className="w-3 h-3" />
      <span className="[writing-mode:vertical-rl] text-[11px] font-semibold tracking-wide">{label}</span>
    </button>
  );
}

/** Small header row shown atop an expanded pane — label plus a collapse toggle,
 *  consistent across Article/Notes/Translation instead of three different affordances. */
function PaneHeader({ label, onCollapse }: { label: string; onCollapse: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <button onClick={onCollapse} title={label} className="text-muted-foreground hover:text-foreground transition-colors">
        <ChevronIcon direction="left" className="w-3 h-3" />
      </button>
    </div>
  );
}

/** Draggable divider between two adjacent expanded panes — a plain (non-draggable)
 *  gap is rendered instead whenever either neighbor is collapsed, since there's
 *  nothing meaningful to resize against a fixed-width strip. */
function PaneDivider({ onDragStart }: { onDragStart?: (e: React.MouseEvent) => void }) {
  if (!onDragStart) return <div className="w-3 shrink-0" />;
  return (
    <div
      onMouseDown={onDragStart}
      role="separator"
      aria-orientation="vertical"
      className="mx-1.5 w-1 shrink-0 cursor-col-resize self-stretch rounded-full bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
    />
  );
}

export function LessonView({ articleId, onBack, onDeleted, onReanalyzed }: Props) {
  const db = useDB();
  const t = useT();
  const { analyze, isAnalyzing } = useAnalyzeArticle();
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const sentenceSpanRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

  // Three-pane layout: Article | AI notes | Translation (the last only once toggled
  // on). Each pane can collapse to a slim strip and, when both neighbors are
  // expanded, be resized by dragging the divider between them — weights are plain
  // flex-grow ratios (1/1/1 = even thirds), so collapsing a pane just removes it
  // from the split and the rest redistribute automatically via flexbox.
  const [showTranslation, setShowTranslation] = useState(false);
  const [articleCollapsed, setArticleCollapsed] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [translationCollapsed, setTranslationCollapsed] = useState(false);
  const [weights, setWeights] = useState<Record<PaneKey, number>>({ article: 1, notes: 1, translation: 1 });
  const articlePaneRef = useRef<HTMLDivElement>(null);
  const notesPaneRef = useRef<HTMLDivElement>(null);
  const translationPaneRef = useRef<HTMLDivElement>(null);
  const paneRefs: Record<PaneKey, React.RefObject<HTMLDivElement>> = {
    article: articlePaneRef,
    notes: notesPaneRef,
    translation: translationPaneRef,
  };

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

  const startPaneDrag = (e: React.MouseEvent, a: PaneKey, b: PaneKey) => {
    e.preventDefault();
    const elA = paneRefs[a].current;
    const elB = paneRefs[b].current;
    if (!elA || !elB) return;
    const startX = e.clientX;
    const wA0 = elA.getBoundingClientRect().width;
    const wB0 = elB.getBoundingClientRect().width;
    const totalPx = wA0 + wB0;
    const weightSum = weights[a] + weights[b];
    const minPx = 220;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const newWidthA = Math.min(totalPx - minPx, Math.max(minPx, wA0 + dx));
      const newWeightA = weightSum * (newWidthA / totalPx);
      setWeights((w) => ({ ...w, [a]: newWeightA, [b]: weightSum - newWeightA }));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
          {/* min-h reserves space for a 2-line title even when it's shorter,
            * so the header renders at a constant height — the notes panel's
            * sticky top offset below assumes that height and would
            * otherwise leave a gap above it for short (1-line) titles. */}
          <h2 className="text-xl font-bold leading-snug mt-1 line-clamp-2 min-h-[3.5rem]">{article.title}</h2>
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
                <BookmarkIcon className="w-3.5 h-3.5" />
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
          onClick={() => setShowTranslation((v) => !v)}
          aria-pressed={showTranslation}
          title={t("reading.translate.button")}
          className={`w-8 h-8 p-0 rounded-lg border flex items-center justify-center transition-colors shrink-0 ${
            showTranslation
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/10"
              : "border-input text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
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

      {/* Article | AI notes | Translation (once toggled on) — each collapsible to a
        * slim strip, and resizable via the divider between any two expanded
        * neighbors. Defaults to even thirds (or halves with translation hidden). */}
      <div className="flex items-start gap-3">
        {articleCollapsed ? (
          <CollapsedPaneStrip label={t("reading.article")} onExpand={() => setArticleCollapsed(false)} />
        ) : (
          <div
            ref={articlePaneRef}
            style={{ flex: `${weights.article} 1 0%` }}
            className="min-w-0 bg-card border border-border rounded-2xl p-6"
          >
            <PaneHeader label={t("reading.article")} onCollapse={() => setArticleCollapsed(true)} />
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
              {/* Only Hacker News (or hnrss-style) lessons carry an hn_item_id — every
                * other origin (plain RSS, pasted text) has none, so this simply doesn't
                * render for them instead of showing an empty/broken comments section. */}
              {article.hn_item_id != null && <HnComments storyId={article.hn_item_id} />}
            </div>
          </div>
        )}

        <PaneDivider onDragStart={!articleCollapsed && !notesCollapsed ? (e) => startPaneDrag(e, "article", "notes") : undefined} />

        {notesCollapsed ? (
          <CollapsedPaneStrip label={t("reading.notesTitle")} onExpand={() => setNotesCollapsed(false)} />
        ) : (
          <div
            ref={notesPaneRef}
            style={{ flex: `${weights.notes} 1 0%` }}
            className="min-w-0 bg-card border border-border rounded-2xl p-4 lg:sticky lg:top-36 lg:max-h-[calc(100vh-10rem)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-xs font-semibold">{t("reading.notesTitle")}</span>
              </div>
              <button onClick={() => setNotesCollapsed(true)} title={t("reading.notesTitle")} className="text-muted-foreground hover:text-foreground transition-colors">
                <ChevronIcon direction="left" className="w-3 h-3" />
              </button>
            </div>
            {article.analysis_markdown.trim() ? (
              <Markdown text={article.analysis_markdown} />
            ) : (
              <p className="text-xs text-muted-foreground">{t("reading.notesEmpty")}</p>
            )}
          </div>
        )}

        {showTranslation && (
          <>
            <PaneDivider onDragStart={!notesCollapsed && !translationCollapsed ? (e) => startPaneDrag(e, "notes", "translation") : undefined} />

            {translationCollapsed ? (
              <CollapsedPaneStrip label={t("reading.translate.button")} onExpand={() => setTranslationCollapsed(false)} />
            ) : (
              <div
                ref={translationPaneRef}
                style={{ flex: `${weights.translation} 1 0%` }}
                className="min-w-0 flex flex-col lg:sticky lg:top-36 lg:h-[calc(100vh-10rem)] overflow-hidden"
              >
                <PaneHeader label={t("reading.translate.button")} onCollapse={() => setTranslationCollapsed(true)} />
                <TranslationPane articleText={article.content} hnItemId={article.hn_item_id} />
              </div>
            )}
          </>
        )}
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
