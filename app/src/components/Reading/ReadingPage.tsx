import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, ArticleListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useReadingStore } from "@/store/readingStore";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";
import { LessonView } from "./LessonView";
import { SparkIcon, FeedIcon } from "@/components/ui/icons";

export function ReadingPage() {
  const db = useDB();
  const t = useT();
  const { analyze, isAnalyzing, progress } = useAnalyzeArticle();
  const draft = useReadingStore((s) => s.draft);
  const clearDraft = useReadingStore((s) => s.clearDraft);
  const pendingArticleId = useReadingStore((s) => s.pendingArticleId);
  const clearPendingArticleId = useReadingStore((s) => s.clearPendingArticleId);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [openArticleId, setOpenArticleId] = useState<number | null>(() => pendingArticleId);
  const autoStarted = useRef(false);

  // Consume a lesson handed over from the Dashboard ("continue learning")
  useEffect(() => {
    if (pendingArticleId !== null) {
      setOpenArticleId(pendingArticleId);
      clearPendingArticleId();
    }
  }, [pendingArticleId]);

  const loadArticles = useCallback(() => {
    db.getArticles().then(setArticles);
  }, [db]);

  useEffect(() => {
    loadArticles();
  }, []);

  const runAnalysis = useCallback(
    async (opts: { text: string; title?: string; sourceUrl?: string; origin?: string }) => {
      const toastId = toast.loading(t("reading.analyzing"));
      try {
        const result = await analyze(opts);
        toast.success(t("reading.toast.analyzed", { n: result.itemCount }), { id: toastId });
        setTitle("");
        setText("");
        loadArticles();
        setOpenArticleId(result.articleId);
      } catch (e: any) {
        toast.error(e.message || t("reading.toast.failed"), { id: toastId });
      }
    },
    [analyze, loadArticles, t]
  );

  // Consume a draft handed over from the HN drawer
  useEffect(() => {
    if (!draft || autoStarted.current) return;
    autoStarted.current = true;
    const d = draft;
    clearDraft();
    setTitle(d.title);
    setText(d.text);
    runAnalysis({ text: d.text, title: d.title, sourceUrl: d.sourceUrl, origin: d.origin });
  }, [draft]);

  const handleAnalyze = () => {
    if (!text.trim() || isAnalyzing) return;
    runAnalysis({ text: text.trim(), title: title.trim() || undefined });
  };

  if (openArticleId !== null) {
    return (
      <div className="p-6 animate-fade-in max-w-6xl">
        <LessonView
          articleId={openArticleId}
          onBack={() => { setOpenArticleId(null); loadArticles(); }}
          onDeleted={() => { setOpenArticleId(null); loadArticles(); }}
          onReanalyzed={(newId) => { setOpenArticleId(newId); loadArticles(); }}
        />
      </div>
    );
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="p-6 space-y-5 animate-fade-in w-full">
      <div>
        <h1 className="text-2xl font-bold">{t("reading.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("reading.subtitle")}</p>
      </div>

      {/* Paste-to-learn card */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <SparkIcon className="w-3.5 h-3.5 text-primary" />
          <h2 className="text-sm font-semibold">{t("reading.pasteTitle")}</h2>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("reading.titlePlaceholder")}
          className="w-full h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("reading.textPlaceholder")}
          rows={7}
          className="w-full p-3 text-sm rounded-lg border border-input bg-background leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
            {t("reading.wordCount", { n: wordCount })}
          </span>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !text.trim()}
            className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            {isAnalyzing ? (
              `${t("reading.analyzing")} ${progress > 0 ? `(${(progress / 1000).toFixed(1)}k)` : ""}`
            ) : (
              <><SparkIcon className="w-3.5 h-3.5" /> {t("reading.analyze")}</>
            )}
          </button>
        </div>
      </div>

      {/* History */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-sm font-semibold">{t("reading.historyTitle")}</span>
        </div>
        {articles.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground px-8 leading-relaxed">
            {t("reading.empty")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {articles.map((a) => (
              <button
                key={a.id}
                onClick={() => setOpenArticleId(a.id)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors text-left"
              >
                {a.origin === "hackernews" ? (
                  <span className="w-5 h-5 rounded bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">Y</span>
                ) : a.origin === "rss" ? (
                  <span className="w-5 h-5 rounded bg-primary/15 text-primary flex items-center justify-center shrink-0">
                    <FeedIcon className="w-3 h-3" />
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">¶</span>
                )}
                <span className="flex-1 min-w-0 text-sm font-medium truncate">{a.title}</span>
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
                  {t("reading.items", { n: a.item_count })}
                  {a.accepted_count > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400"> · {t("reading.acceptedCount", { n: a.accepted_count })}</span>
                  )}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground/60 shrink-0 w-20 text-right">
                  {a.created_at.slice(0, 10)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
