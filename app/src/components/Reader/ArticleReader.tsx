import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePodcastPlayerStore, type PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { SpeakerIcon, SparkIcon, TranslateIcon, ReplyIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { HnComments } from "@/components/Reader/HnComments";
import { TranslationPane } from "@/components/Reading/TranslationPane";
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
  /** Learn should hand off the extracted plain text — no manual copy/paste needed. `commentsText`
   * (when HN comments are loaded) is analyzed separately for native/colloquial usage. */
  onLearn: (article: { title: string; text: string; commentsText?: string }) => void;
  onOpenExternal: () => void;
  /** The entry's own audio enclosure (podcast episodes). When set, the listen
   * button plays this original recording instead of synthesizing TTS. */
  audio?: PodcastTrack;
  /** Set when this entry came from an hnrss.org-style feed — shows the HN discussion below the article. */
  hnItemId?: number | null;
}

const FONT_STEPS = [15, 16, 17.5, 19, 21] as const;

export function ArticleReader({ url, domain, onLearn, onOpenExternal, audio, hnItemId }: Props) {
  const t = useT();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [article, setArticle] = useState<FetchedArticle | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fontStep, setFontStep] = useState(1);
  const [hnComments, setHnComments] = useState<HnComment[] | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  /** Fraction of the split's width given to the original article (vs. translation) —
   *  dragged via the divider between them. */
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitContainerRef = useRef<HTMLDivElement>(null);
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

  const handleListenComments = () => {
    if (commentsPlayerActive) {
      playerToggle();
      return;
    }
    if (!hnComments || hnComments.length === 0) return;
    playerStart(commentsSourceKey, commentsToSpeechText(hnComments));
    setReaderOrigin();
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

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
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

  useEffect(() => {
    const seq = ++requestSeq.current;
    setStatus("loading");
    setArticle(null);
    setHnComments(null);
    invoke<FetchedArticle>("fetch_article", { url })
      .then((a) => {
        if (seq !== requestSeq.current) return;
        setArticle(a);
        setStatus("ready");
      })
      .catch((e) => {
        if (seq !== requestSeq.current) return;
        setErrorMsg(typeof e === "string" ? e : String(e?.message ?? e));
        setStatus("error");
      });
  }, [url]);

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
      <div ref={splitContainerRef} className={showTranslation ? "flex px-6 py-10" : "px-6 py-10"}>
        <div
          className={showTranslation ? "min-w-0" : "max-w-[68ch] mx-auto"}
          style={showTranslation ? { width: `${splitRatio * 100}%` } : undefined}
        >
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

          <div className="mt-6 flex items-center gap-2">
            <Button
              onClick={() =>
                onLearn({
                  title: article.title,
                  text: article.text_content,
                  commentsText: hnComments ? flattenHnComments(hnComments) : undefined,
                })
              }
              title={t("hn.learn")}
              aria-label={t("hn.learn")}
              className="w-9 h-9 p-0 rounded-lg flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <SparkIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={handleListen}
              title={audio ? t("podcast.listenEpisode") : t("tts.listenToArticle")}
              aria-label={audio ? t("podcast.listenEpisode") : t("tts.listenToArticle")}
              className={`w-9 h-9 p-0 rounded-lg flex items-center justify-center transition-colors ${
                playerActive
                  ? "bg-primary/10 text-primary hover:bg-primary/10"
                  : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <SpeakerIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowTranslation((v) => !v)}
              aria-pressed={showTranslation}
              title={t("reading.translate.button")}
              aria-label={t("reading.translate.button")}
              className={`w-9 h-9 p-0 rounded-lg flex items-center justify-center transition-colors ${
                showTranslation
                  ? "bg-primary/10 text-primary hover:bg-primary/10"
                  : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
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
                className={`w-9 h-9 p-0 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 ${
                  commentsPlayerActive
                    ? "bg-primary/10 text-primary hover:bg-primary/10"
                    : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <ReplyIcon className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div
            className="reader-article-content text-foreground mt-8"
            style={{ fontSize: `${FONT_STEPS[fontStep]}px`, lineHeight: 1.85 }}
            dangerouslySetInnerHTML={{ __html: article.content_html }}
          />

          {hnItemId != null && <HnComments storyId={hnItemId} onLoaded={setHnComments} />}
        </div>

        {showTranslation && (
          <>
            <div
              onMouseDown={handleSplitDragStart}
              role="separator"
              aria-orientation="vertical"
              className="mx-3 w-1 shrink-0 cursor-col-resize self-stretch rounded-full bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
            />
            <div className="min-w-0 flex-1 sticky top-0 h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
              <TranslationPane articleText={article.text_content} hnItemId={hnItemId ?? null} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
