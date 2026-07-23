import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, ArticleListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useReadingStore } from "@/store/readingStore";
import { useNavStore } from "@/store/navStore";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";
import { LessonView } from "./LessonView";
import { SavedSentencesView } from "./SavedSentencesView";
import { SparkIcon, FeedIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

export function ReadingPage() {
  const db = useDB();
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  const { analyze, isAnalyzing, progress } = useAnalyzeArticle();
  const draft = useReadingStore((s) => s.draft);
  const clearDraft = useReadingStore((s) => s.clearDraft);
  const pendingArticleId = useReadingStore((s) => s.pendingArticleId);
  const clearPendingArticleId = useReadingStore((s) => s.clearPendingArticleId);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [openArticleId, setOpenArticleId] = useState<number | null>(() => pendingArticleId);
  const [tab, setTab] = useState<"lessons" | "saved">("lessons");
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

  // Runs to completion even if the user navigates away mid-analysis — analyze()'s
  // AI call isn't tied to this component staying mounted. If they've left, the
  // component-local calls below (setTitle/setOpenArticleId/loadArticles) just
  // become harmless no-ops; setPendingArticleId + the toast's "View" action are
  // what let them find and open the finished lesson from wherever they ended up.
  const runAnalysis = useCallback(
    async (opts: { text: string; title?: string; sourceUrl?: string; origin?: string; commentsText?: string }) => {
      const toastId = toast.loading(t("reading.analyzing"));
      try {
        const result = await analyze(opts);
        toast.success(t("reading.toast.analyzed"), {
          id: toastId,
          action: {
            label: t("reading.toast.view"),
            onClick: () => {
              navigate("reading");
              useReadingStore.getState().setPendingArticleId(result.articleId);
            },
          },
        });
        setTitle("");
        setText("");
        loadArticles();
        setOpenArticleId(result.articleId);
      } catch (e: any) {
        toast.error(e.message || t("reading.toast.failed"), { id: toastId });
      }
    },
    [analyze, loadArticles, navigate, t]
  );

  // Consume a draft handed over from the HN drawer
  useEffect(() => {
    if (!draft || autoStarted.current) return;
    autoStarted.current = true;
    const d = draft;
    clearDraft();
    setTitle(d.title);
    setText(d.text);
    runAnalysis({ text: d.text, title: d.title, sourceUrl: d.sourceUrl, origin: d.origin, commentsText: d.commentsText });
  }, [draft]);

  const handleAnalyze = () => {
    if (!text.trim() || isAnalyzing) return;
    runAnalysis({ text: text.trim(), title: title.trim() || undefined });
  };

  if (openArticleId !== null) {
    return (
      <div className="p-6 animate-fade-in">
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

  const tabPill = (active: boolean) =>
    `h-8 px-3 rounded-full border text-xs font-semibold transition-colors ${
      active
        ? "border-primary/40 bg-primary/10 text-primary"
        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className="p-6 space-y-5 animate-fade-in w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("reading.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("reading.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="ghost" onClick={() => setTab("lessons")} className={tabPill(tab === "lessons")}>
            {t("reading.tabs.lessons")}
          </Button>
          <Button variant="ghost" onClick={() => setTab("saved")} className={tabPill(tab === "saved")}>
            {t("reading.tabs.saved")}
          </Button>
        </div>
      </div>

      {tab === "saved" ? (
        <SavedSentencesView />
      ) : (
        <>
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
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !text.trim()}
                className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                {isAnalyzing ? (
                  `${t("reading.analyzing")} ${progress > 0 ? `(${(progress / 1000).toFixed(1)}k)` : ""}`
                ) : (
                  <><SparkIcon className="w-3.5 h-3.5" /> {t("reading.analyze")}</>
                )}
              </Button>
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
                  <Button
                    key={a.id}
                    variant="ghost"
                    onClick={() => setOpenArticleId(a.id)}
                    className="h-auto w-full rounded-none flex items-center justify-start gap-3 px-5 py-3 hover:bg-muted/40 transition-colors text-left"
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
                    <span className="text-[11px] font-mono text-muted-foreground/60 shrink-0 w-20 text-right">
                      {a.created_at.slice(0, 10)}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
