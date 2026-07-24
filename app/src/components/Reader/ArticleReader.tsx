import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePodcastPlayerStore, type PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { useLearnChatStore } from "@/store/learnChatStore";
import { useNavStore } from "@/store/navStore";
import { useLearnArticle } from "@/hooks/useLearnArticle";
import { SpeakerIcon, SparkIcon, TranslateIcon, ReplyIcon, CheckIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { HnComments } from "@/components/Reader/HnComments";
import { TranslationPane } from "@/components/shared/TranslationPane";
import { Markdown } from "@/components/AiChat/Markdown";
import { flattenHnComments, commentsToSpeechText, type HnComment } from "@/lib/hnComments";

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

export function ArticleReader({ url, domain, onOpenExternal, audio, hnItemId, toolbarSlot }: Props) {
  const t = useT();
  const { startLearn } = useLearnArticle();
  const learnJob = useLearnChatStore((s) => s.jobs[url]);
  const cancelLearn = useLearnChatStore((s) => s.cancel);
  const navigate = useNavStore((s) => s.navigate);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [article, setArticle] = useState<FetchedArticle | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fontStep, setFontStep] = useState(1);
  const [hnComments, setHnComments] = useState<HnComment[] | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  // The analyze trigger lives in the reader bar now (see ReaderView) — this page
  // only publishes its article there and renders whatever comes back.
  const showNotes = useReaderNotesStore((s) => s.showNotes);
  const analyzingNotes = useReaderNotesStore((s) => s.analyzing);
  const notesMarkdown = useReaderNotesStore((s) => s.notesMarkdown);
  // The right-hand panel shows one thing at a time. Defaults to notes since
  // that's the more common of the two; switches to translation the moment the
  // user asks for it, and back to notes when a fresh analysis lands.
  const [rightView, setRightView] = useState<"notes" | "translation">("notes");
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
  const hasSidePanes = showNotes || showTranslation;
  const activeView = showNotes && showTranslation ? rightView : showNotes ? "notes" : "translation";

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
      const sessionId = learnJob.sessionId;
      navigate("chat");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("tanwords:open-chat", { detail: { sessionId } })), 0);
      return;
    }
    startLearn(url, {
      title: article.title,
      text: article.text_content,
      commentsText: hnComments ? flattenHnComments(hnComments) : undefined,
    });
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
    setStatus("loading");
    setArticle(null);
    setHnComments(null);
    useReaderNotesStore.getState().setArticle(null);
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
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground max-w-md">{t("reader.extractFailed")}</p>
        {errorMsg && <p className="text-[11px] font-mono text-muted-foreground/50 max-w-md truncate">{errorMsg}</p>}
        <Button
          onClick={onOpenExternal}
          className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t("hn.reader.external")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
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
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {learnJob?.status === "running" ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
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
              <SpeakerIcon className="w-4 h-4" />
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

        {/* Article on the left, always. The right panel appears once notes or a
          * translation is requested, and shows exactly one of them at a time —
          * a small toggle only shows up once there's actually a second thing to
          * switch to. Notes is populated from the reader bar's analyze button
          * (see ReaderView); it just renders whatever markdown comes back. */}
        <div className="mt-6 flex items-start gap-3">
          <div className={hasSidePanes ? "min-w-0 flex-1" : "min-w-0 w-full max-w-[68ch] mx-auto"}>
            <div
              className="reader-article-content text-foreground"
              style={{ fontSize: `${FONT_STEPS[fontStep]}px`, lineHeight: 1.85 }}
              dangerouslySetInnerHTML={{ __html: article.content_html }}
            />
            {hnItemId != null && <HnComments storyId={hnItemId} onLoaded={handleHnCommentsLoaded} />}
          </div>

          {hasSidePanes && (
            <div className="min-w-0 flex-1 sticky top-0 h-[calc(100vh-3rem)] flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              {showNotes && showTranslation && (
                <div className="flex items-center gap-1 border-b border-border p-1.5 shrink-0">
                  <button
                    onClick={() => setRightView("notes")}
                    className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      activeView === "notes" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("reading.notesTitle")}
                  </button>
                  <button
                    onClick={() => setRightView("translation")}
                    className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      activeView === "translation" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("reading.translate.button")}
                  </button>
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
              ) : (
                <TranslationPane articleText={article.text_content} hnItemId={hnItemId ?? null} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
