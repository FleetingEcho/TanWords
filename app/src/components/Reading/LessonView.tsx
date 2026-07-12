import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useDB, ArticleDetail, ExtractedItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SentenceParagraph, ParagraphSentence } from "./SentenceParagraph";
import { SentenceAnalysisPanel } from "./SentenceAnalysisPanel";
import { splitSentences } from "@/lib/sentences";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { SpeakerIcon } from "@/components/ui/icons";
import { SpeakButton } from "@/components/ui/SpeakButton";

interface Props {
  articleId: number;
  onBack: () => void;
  onDeleted: () => void;
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
  const isWord = item.kind === "word";
  const dimmed = item.status === "dismissed" || item.status === "known";

  return (
    <div
      ref={innerRef}
      className={`px-4 py-3 space-y-1.5 transition-all ${flash ? "ring-2 ring-primary/50 bg-primary/5" : ""} ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${isWord ? "text-primary" : "text-amber-700 dark:text-amber-400"}`}>
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
              {isWord ? t("reading.addToVocab") : t("reading.savePattern")}
            </button>
            {isWord && (
              <button
                onClick={() => onAction(item, "know")}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t("reading.know")}
              </button>
            )}
            <button
              onClick={() => onAction(item, "dismiss")}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("reading.dismiss")}
            </button>
          </>
        )}
        {item.status === "accepted" && (
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            ✓ {isWord ? t("reading.added") : t("reading.savedPattern")}
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

export function LessonView({ articleId, onBack, onDeleted }: Props) {
  const db = useDB();
  const t = useT();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [activeSentence, setActiveSentence] = useState<string | null>(null);
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
      .then(setArticle)
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
    else playerStart(sourceKey, article.content);
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
        if (item.kind === "word") {
          await db.addWord(item.text, item.zh, undefined, item.level || undefined);
          window.dispatchEvent(new CustomEvent("vocab-updated"));
        } else {
          // Patterns land in the pattern library, carrying the real sentence
          // and its article as the first example.
          const patternId = await db.addPattern({
            pattern: item.text,
            zh: item.zh,
            note: item.note || undefined,
            level: item.level || undefined,
            example: item.context_sentence
              ? { sentence: item.context_sentence, source: article?.title ?? "", articleId }
              : undefined,
          });
          if (patternId === null) return; // wrapper already toasted; stay candidate
          window.dispatchEvent(new CustomEvent("patterns-updated"));
          toast.success(t("reading.toast.patternSaved"));
        }
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
  const patterns = article.items.filter((it) => it.kind === "pattern");
  const pendingWords = words.filter((it) => it.status === "candidate").length;

  return (
    <div className="space-y-4">
      {/* Lesson header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            ← {t("reading.back")}
          </button>
          <h2 className="text-xl font-bold leading-snug mt-1">{article.title}</h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {article.origin === "hackernews" && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-sm bg-orange-500 text-white text-[8px] font-bold flex items-center justify-center">Y</span>
                Hacker News
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

      {/* Two-column lesson */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4 items-start">
        {/* Article body — every sentence clickable for close-reading */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <p className="text-[11px] text-muted-foreground -mb-1">💡 {t("reading.sentence.hint")}</p>
          {paragraphChunks.map((chunk, i) => {
            const chunkSentences: ParagraphSentence[] = articleSentences
              .map((s, globalIndex) => ({ s, globalIndex }))
              .filter(({ s }) => s.start >= chunk.start && s.start < chunk.end)
              .map(({ s, globalIndex }) => ({ text: s.text, globalIndex }));
            return (
              <SentenceParagraph
                key={i}
                sentences={chunkSentences}
                items={article.items}
                onJump={jumpToItem}
                activeSentence={activeSentence}
                onSelectSentence={(s) => setActiveSentence((prev) => (prev === s ? null : s))}
                playerActive={playerActive}
                playerCurrentIndex={playerCurrentIndex}
                onPlayerJump={playerJumpTo}
                registerSpanRef={registerSpanRef}
              />
            );
          })}
        </div>

        {/* Extracted items panel */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          {activeSentence && (
            <SentenceAnalysisPanel
              sentence={activeSentence}
              articleTitle={article.title}
              articleId={articleId}
              onClose={() => setActiveSentence(null)}
            />
          )}
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
          {patterns.length > 0 && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold">{t("reading.patterns")}</span>
                <span className="text-[11px] font-mono text-muted-foreground">{patterns.length}</span>
              </div>
              <div className="divide-y divide-border">
                {patterns.map((it) => (
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
        </div>
      </div>
    </div>
  );
}
