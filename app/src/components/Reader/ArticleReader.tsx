import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import type { ReadingComment } from "@/hooks/useDB.reading";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePodcastPlayerStore, type PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { useLearnChatStore } from "@/store/learnChatStore";
import { useLearnArticle } from "@/hooks/useLearnArticle";
import { SpeakerIcon, SparkIcon, TranslateIcon, ReplyIcon, CheckIcon, PlayIcon, PauseIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { HnComments } from "@/components/Reader/HnComments";
import { ScratchPasteScreen } from "@/components/Reader/ScratchPasteScreen";
import { ArticleComments } from "@/components/Reader/ArticleComments";
import { TranslationPane } from "@/components/shared/TranslationPane";
import { Markdown } from "@/components/AiChat/Markdown";
import { AiChatModal } from "@/components/AiChat/AiChatModal";
import { MessageSquareText, Copy } from "lucide-react";
import { toast } from "sonner";
import { flattenHnComments, commentsToSpeechText, type HnComment } from "@/lib/hnComments";
import { buildArticleMarkdown } from "@/lib/articleMarkdown";

export interface FetchedArticle {
  title: string;
  byline: string | null;
  site_name: string | null;
  content_html: string;
  text_content: string;
  excerpt: string | null;
}

interface Props {
  url: string;
  /** Domain label shown in the reader bar; also used to restore this view from the player bar. */
  domain: string;
  onOpenExternal: () => void;
  /** The entry's own audio enclosure (podcast episodes). When set, the listen
   * button plays this original recording instead of synthesizing TTS. */
  audio?: PodcastTrack;
  /** Set when this entry came from an hnrss.org-style feed — shows the HN discussion below the article. */
  hnItemId?: number | null;
  /** Reader bar node (see ReaderView) that the learn/listen/translate/comments
   *  buttons portal into once the article is ready — kept here because their
   *  handlers need article + player state that lives in this component. */
  toolbarSlot?: HTMLDivElement | null;
}

const FONT_STEPS = [15, 16, 17.5, 19, 21] as const;

/** URLs of the form `paste:<n>` have nothing to fetch — the reader opens
 *  straight into its paste box and builds the article from what you drop in.
 *  See components/Reader/ReadingPage.tsx. */
export const SCRATCH_URL_PREFIX = "paste:";

/** `library:<id>` opens an article already saved in the reading library —
 *  same reader, same tools, no network. */
export const LIBRARY_URL_PREFIX = "library:";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The title for a pasted article when the learner didn't write one. A
 *  pasted article usually leads with its own title, so the first line is
 *  used when it reads like one; otherwise the opening words stand in. Never
 *  a generic label like "Pasted" — that's what every entry in the library
 *  would end up called. */
function titleFromPastedText(text: string, explicit: string): string {
  if (explicit.trim()) return explicit.trim();
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "";
  if (first.length <= 120) return first;
  return first.slice(0, 60).replace(/\s+\S*$/, "") + "…";
}

/** Turns a plain-text paste into the same shape `fetch_article` returns, so the rest of
 *  the reader (font size, TTS, translation, notes) doesn't need to know the source. */
function articleFromPastedText(text: string, title: string): FetchedArticle {
  const content_html = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
  return {
    title: titleFromPastedText(text, title),
    byline: null,
    site_name: "",
    content_html,
    text_content: text,
    excerpt: null,
  };
}

export function ArticleReader({ url, domain, onOpenExternal, audio, hnItemId, toolbarSlot }: Props) {
  const t = useT();
  const { startLearn } = useLearnArticle();
  const learnJob = useLearnChatStore((s) => s.jobs[url]);
  const cancelLearn = useLearnChatStore((s) => s.cancel);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [article, setArticle] = useState<FetchedArticle | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fontStep, setFontStep] = useState(1);
  const [hnComments, setHnComments] = useState<HnComment[] | null>(null);
  const [pastedText, setPastedText] = useState("");
  const db = useDB();
  // Set once the text on screen is a row in the reading library, so its
  // comments can be loaded and new ones attached.
  const [articleId, setArticleId] = useState<number | null>(null);
  const [comments, setComments] = useState<ReadingComment[]>([]);
  const [showComments, setShowComments] = useState(false);
  const readingRef = useRef<HTMLDivElement>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatModalSessionId, setChatModalSessionId] = useState<string | null>(null);
  // The analyze trigger lives in the reader bar now (see ReaderView) — this page
  // only publishes its article there and renders whatever comes back.
  const showNotes = useReaderNotesStore((s) => s.showNotes);
  const analyzingNotes = useReaderNotesStore((s) => s.analyzing);
  const notesMarkdown = useReaderNotesStore((s) => s.notesMarkdown);
  // The right-hand panel shows one thing at a time. Defaults to notes since
  // that's the more common of the two; switches to translation the moment the
  // user asks for it, and back to notes when a fresh analysis lands.
  const [rightView, setRightView] = useState<"notes" | "translation" | "comments">("notes");
  const requestSeq = useRef(0);
  const playerSourceKey = useTtsPlayerStore((s) => s.sourceKey);
  const playerStart = useTtsPlayerStore((s) => s.start);
  const playerToggle = useTtsPlayerStore((s) => s.toggle);
  const podcastTrackUrl = usePodcastPlayerStore((s) => s.track?.audioUrl);
  const podcastStatus = usePodcastPlayerStore((s) => s.status);
  const sourceKey = `reader-${url}`;
  const commentsSourceKey = `reader-comments-${url}`;
  const podcastActive = !!audio && podcastStatus !== "idle" && podcastTrackUrl === audio.audioUrl;
  const playerActive = podcastActive || playerSourceKey === sourceKey;
  const commentsPlayerActive = playerSourceKey === commentsSourceKey;
  // Article renders full-width and centered for comfortable reading while it's the
  // only pane; once the right panel joins it, they share the row equally.
  const hasSidePanes = showNotes || showTranslation || showComments;
  const openPanes = [showNotes && "notes", showTranslation && "translation", showComments && "comments"].filter(Boolean) as ("notes" | "translation" | "comments")[];
  const activeView = openPanes.includes(rightView) ? rightView : openPanes[0];

  const handleListen = () => {
    if (audio) {
      // Podcast episode: play the original recording, never TTS.
      if (podcastActive) usePodcastPlayerStore.getState().toggle();
      else {
        usePodcastPlayerStore.getState().play(audio);
        setReaderOrigin();
      }
      return;
    }
    if (playerActive) playerToggle();
    else if (article) {
      playerStart(sourceKey, article.text_content);
      setReaderOrigin();
    }
  };

  /** Idle: kicks off the background Reading Tutor analysis. Running: clicking
   *  again cancels it. Done: opens the chat conversation it was saved into. */
  const handleLearnClick = () => {
    if (!article) return;
    if (learnJob?.status === "running") {
      cancelLearn(url);
      return;
    }
    if (learnJob?.status === "done" && learnJob.sessionId) {
      setChatModalSessionId(learnJob.sessionId);
      return;
    }
    startLearn(url, {
      title: article.title,
      text: article.text_content,
      commentsText: hnComments ? flattenHnComments(hnComments) : undefined,
    });
  };

  /** Copies the article (and the HN thread when loaded) as markdown — for
   *  pasting into an external AI chat, so nothing is truncated. */
  const handleCopyMarkdown = async () => {
    if (!article) return;
    const markdown = buildArticleMarkdown({
      title: article.title,
      byline: article.byline,
      siteName: article.site_name,
      sourceUrl: url.startsWith(SCRATCH_URL_PREFIX) || url.startsWith(LIBRARY_URL_PREFIX) ? undefined : url,
      contentHtml: article.content_html,
      comments: hnComments,
    });
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("reader.copyFailed"));
    }
  };

  const handleListenComments = () => {
    if (commentsPlayerActive) {
      playerToggle();
      return;
    }
    if (!hnComments || hnComments.length === 0) return;
    playerStart(commentsSourceKey, commentsToSpeechText(hnComments));
    setReaderOrigin();
  };

  const handlePasteSubmit = async (title?: string) => {
    const text = pastedText.trim();
    if (!text) return;
    const built = articleFromPastedText(text, title?.trim() || "");
    setArticle(built);
    setStatus("ready");
    setErrorMsg("");
    // Everything read here joins the library, so it can be found again and
    // annotated — by the user or by an agent over MCP.
    const id = await db.saveReadingArticle(built.title, built.text_content, "paste");
    if (id > 0) {
      setArticleId(id);
      window.dispatchEvent(new CustomEvent("articles-updated"));
    }
    useReaderNotesStore.getState().setArticle({
      url,
      title: built.title,
      text: built.text_content,
      hnItemId: hnItemId ?? null,
    });
  };

  const handleHnCommentsLoaded = (comments: HnComment[]) => {
    setHnComments(comments);
    useReaderNotesStore.getState().setCommentsText(flattenHnComments(comments) || undefined);
  };

  const setReaderOrigin = () => {
    if (!article) return;
    usePlayerOriginStore.getState().setOrigin({
      kind: "reader",
      url,
      title: article.title,
      domain,
      audioUrl: audio?.audioUrl ?? null,
      feedTitle: audio?.feedTitle ?? "",
      hnItemId: hnItemId ?? null,
    });
  };

  useEffect(() => {
    const seq = ++requestSeq.current;
    setArticle(null);
    setHnComments(null);
    useReaderNotesStore.getState().setArticle(null);
    setArticleId(null);
    setComments([]);
    if (url.startsWith(LIBRARY_URL_PREFIX)) {
      const id = Number(url.slice(LIBRARY_URL_PREFIX.length));
      setStatus("loading");
      db.getReadingArticle(id, true).then((detail) => {
        if (seq !== requestSeq.current) return;
        if (!detail) {
          setErrorMsg("");
          setStatus("error");
          return;
        }
        setArticle({ ...articleFromPastedText(detail.content, detail.title), title: detail.title });
        setArticleId(detail.id);
        setStatus("ready");
        useReaderNotesStore.getState().setArticle({
          url, title: detail.title, text: detail.content, hnItemId: null,
        });
      });
      return;
    }
    if (url.startsWith(SCRATCH_URL_PREFIX)) {
      // Nothing to fetch — "error" is the state that already renders the
      // paste box, with the extraction-failed copy swapped out below.
      setStatus("error");
      setErrorMsg("");
      return;
    }
    setStatus("loading");
    invoke<FetchedArticle>("fetch_article", { url })
      .then((a) => {
        if (seq !== requestSeq.current) return;
        setArticle(a);
        setStatus("ready");
        useReaderNotesStore.getState().setArticle({
          url,
          title: a.title,
          text: a.text_content,
          hnItemId: hnItemId ?? null,
        });
      })
      .catch((e) => {
        if (seq !== requestSeq.current) return;
        setErrorMsg(typeof e === "string" ? e : String(e?.message ?? e));
        setStatus("error");
      });
  }, [url]);

  // Notes left on this article — by the user here, or by an agent through
  // MCP while the article sits open.
  useEffect(() => {
    if (articleId === null) { setComments([]); return; }
    let cancelled = false;
    const load = () => { void db.listReadingComments(articleId).then((rows) => { if (!cancelled) setComments(rows); }); };
    load();
    window.addEventListener("articles-updated", load);
    return () => { cancelled = true; window.removeEventListener("articles-updated", load); };
  }, [articleId, db]);

  // Leaving the reader entirely (not just switching articles, which the effect
  // above already handles) — the reader bar's analyze button should disappear
  // once there's nothing here to analyze.
  useEffect(() => () => useReaderNotesStore.getState().setArticle(null), []);

  // Bring notes to the front of the right panel the moment they're requested
  // (the reader bar's analyze button, not this component, sets showNotes).
  useEffect(() => {
    if (showNotes) setRightView("notes");
  }, [showNotes]);

  if (status === "loading") {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        <span className="text-xs text-muted-foreground">{t("reader.loading")}</span>
      </div>
    );
  }

  if (status === "error" || !article) {
    // The paste-in reader opens here on purpose, and gets its own screen.
    if (url.startsWith(SCRATCH_URL_PREFIX)) {
      return <ScratchPasteScreen value={pastedText} onChange={setPastedText} onSubmit={(title) => void handlePasteSubmit(title)} />;
    }
    // Otherwise this is an article that couldn't be extracted: offer the
    // original page, with the paste box as a fallback.
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
        <div className="max-w-[68ch] mx-auto flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground max-w-md">{t("reader.extractFailed")}</p>
          {errorMsg && <p className="text-[11px] font-mono text-muted-foreground/50 max-w-md truncate">{errorMsg}</p>}
          <Button
            onClick={onOpenExternal}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("hn.reader.external")}
          </Button>

          <div className="w-full mt-6 text-left">
            <p className="text-xs text-muted-foreground mb-2">{t("reader.pastePrompt")}</p>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handlePasteSubmit(); }}
              placeholder={t("reader.pastePlaceholder")}
              rows={10}
              className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 resize-y outline-none transition-colors focus:border-primary/50 focus:bg-background"
            />
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() => void handlePasteSubmit()}
                disabled={!pastedText.trim()}
                className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {t("reader.pasteSubmit")}
              </Button>
            </div>
          </div>

          {hnItemId != null && (
            <div className="w-full text-left">
              <HnComments storyId={hnItemId} onLoaded={handleHnCommentsLoaded} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    // Two independent columns: the article scrolls on the left, and the side
    // panel (notes / translation / comments) fills the reader's real height on
    // the right with its own scroll — sizing it off 100vh instead would
    // overshoot, since the feeds tab bar above and the player bar below both
    // eat into the viewport, leaving the panel's bottom unreachable.
    <div className="flex-1 min-h-0 flex">
      <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="px-6 py-10">
        <div className={hasSidePanes ? "" : "max-w-[68ch] mx-auto"}>
          {/* Font size control */}
          <div className="flex items-center justify-end gap-1 mb-6 -mt-2">
            <Button
              variant="ghost"
              onClick={() => setFontStep((s) => Math.max(0, s - 1))}
              disabled={fontStep === 0}
              className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors text-xs font-bold"
              title={t("reader.fontSmaller")}
            >
              A-
            </Button>
            <Button
              variant="ghost"
              onClick={() => setFontStep((s) => Math.min(FONT_STEPS.length - 1, s + 1))}
              disabled={fontStep === FONT_STEPS.length - 1}
              className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors text-sm font-bold"
              title={t("reader.fontLarger")}
            >
              A+
            </Button>
          </div>

          <h1 className="text-[1.9em] font-bold leading-tight text-foreground">{article.title}</h1>
          {(article.byline || article.site_name) && (
            <p className="text-xs text-muted-foreground mt-3">
              {[article.byline, article.site_name].filter(Boolean).join(" · ")}
            </p>
          )}

        </div>

        {toolbarSlot && createPortal(
          <>
            <Button
              variant="ghost"
              onClick={() => void handleCopyMarkdown()}
              title={t("reader.copyMarkdown")}
              aria-label={t("reader.copyMarkdown")}
              className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                copied ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {copied ? <CheckIcon className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              onClick={handleLearnClick}
              title={
                learnJob?.status === "running" ? t("reader.learnCancel")
                : learnJob?.status === "done" ? t("reader.learnOpen")
                : t("reader.learn")
              }
              aria-label={
                learnJob?.status === "running" ? t("reader.learnCancel")
                : learnJob?.status === "done" ? t("reader.learnOpen")
                : t("reader.learn")
              }
              className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                learnJob?.status === "done"
                  ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {learnJob?.status === "running" ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              ) : learnJob?.status === "done" ? (
                <CheckIcon className="w-4 h-4" />
              ) : (
                <SparkIcon className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleListen}
              title={audio ? t("podcast.listenEpisode") : t("tts.listenToArticle")}
              aria-label={audio ? t("podcast.listenEpisode") : t("tts.listenToArticle")}
              className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                playerActive
                  ? "bg-primary/10 text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {audio ? (
                podcastActive && podcastStatus === "playing" ? (
                  <PauseIcon className="w-4 h-4" />
                ) : (
                  <PlayIcon className="w-4 h-4" />
                )
              ) : (
                <SpeakerIcon className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowTranslation((v) => {
                  if (!v) setRightView("translation");
                  return !v;
                });
              }}
              aria-pressed={showTranslation}
              title={t("reading.translate.button")}
              aria-label={t("reading.translate.button")}
              className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                showTranslation
                  ? "bg-primary/10 text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <TranslateIcon className="w-4 h-4" />
            </Button>
            {articleId !== null && (
              <Button
                variant="ghost"
                onClick={() => { setShowComments((v) => { if (!v) setRightView("comments"); return !v; }); }}
                aria-pressed={showComments}
                title={t("library.comments", { n: comments.length })}
                className={`relative w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                  showComments ? "bg-primary/10 text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <MessageSquareText className="w-4 h-4" />
                {comments.length > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
              </Button>
            )}
            {hnItemId != null && (
              <Button
                variant="ghost"
                onClick={handleListenComments}
                disabled={!hnComments || hnComments.length === 0}
                title={t("hn.comments.listen")}
                aria-label={t("hn.comments.listen")}
                className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 ${
                  commentsPlayerActive
                    ? "bg-primary/10 text-primary hover:bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <ReplyIcon className="w-4 h-4" />
              </Button>
            )}
          </>,
          toolbarSlot
        )}

        {/* data-reader-selectable tells the global selection toolbar that
          * anything picked in here (article body or HN comments) came from
          * the reader, so saved sentences are attributed to it. */}
        <div ref={readingRef} data-reader-selectable className={`mt-6 min-w-0 ${hasSidePanes ? "" : "w-full max-w-[68ch] mx-auto"}`}>
          <div
            className="reader-article-content text-foreground"
            style={{ fontSize: `${FONT_STEPS[fontStep]}px`, lineHeight: 1.85 }}
            dangerouslySetInnerHTML={{ __html: article.content_html }}
          />
          {hnItemId != null && <HnComments storyId={hnItemId} onLoaded={handleHnCommentsLoaded} />}
        </div>
      </div>
      </div>

      {/* The side panel appears once notes or a translation is requested, and
        * shows exactly one of them at a time — a small toggle only shows up
        * once there's actually a second thing to switch to. Notes is populated
        * from the reader bar's analyze button (see ReaderView); it just renders
        * whatever markdown comes back. */}
      {hasSidePanes && (
        <div className="min-w-0 flex-1 flex flex-col overflow-hidden border-l border-border/40 pl-4">
          {openPanes.length > 1 && (
            <div className="flex items-center gap-1 border-b border-border p-1.5 shrink-0">
              {openPanes.map((pane) => (
                <button
                  key={pane}
                  onClick={() => setRightView(pane)}
                  className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activeView === pane ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pane === "notes" ? t("reading.notesTitle") : pane === "translation" ? t("reading.translate.button") : t("library.comments", { n: comments.length })}
                </button>
              ))}
            </div>
          )}

          {activeView === "notes" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {analyzingNotes ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                  {t("command.analyzing")}
                </div>
              ) : notesMarkdown ? (
                <Markdown text={notesMarkdown} />
              ) : (
                <p className="text-xs text-muted-foreground">{t("reading.notesEmpty")}</p>
              )}
            </div>
          ) : activeView === "comments" ? (
            <ArticleComments
              comments={comments}
              onDelete={async (id) => { await db.deleteReadingComment(id); window.dispatchEvent(new CustomEvent("articles-updated")); }}
              onAdd={async (body) => {
                if (articleId === null) return;
                await db.addReadingComment(articleId, body);
                window.dispatchEvent(new CustomEvent("articles-updated"));
              }}
            />
          ) : (
            <TranslationPane articleText={article.text_content} hnItemId={hnItemId ?? null} />
          )}
        </div>
      )}

      <AiChatModal
        open={chatModalSessionId !== null}
        onClose={() => setChatModalSessionId(null)}
        sessionId={chatModalSessionId ?? undefined}
      />
    </div>
  );
}
