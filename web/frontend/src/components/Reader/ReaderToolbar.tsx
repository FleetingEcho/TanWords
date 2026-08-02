import { useEffect } from "react";
import { SparkIcon, TranslateIcon, CheckIcon, PlayIcon, PauseIcon, BookmarkIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MessageSquareText, Copy } from "lucide-react";
import type { PodcastTrack } from "@/store/podcastPlayerStore";
import { useFeedBookmarksStore } from "@/store/feedBookmarksStore";
import type { ArticleReaderState } from "./hooks/useArticleReaderState";

/** The learn/listen/translate/comments buttons that portal into the reader
 * bar (see ReaderView) once the article is ready. Split out of ArticleReader
 * purely for size — it's one big, mostly self-contained JSX block that reads
 * from useArticleReaderState's return value. */
export function ReaderToolbar({
  state, url, domain, audio, hnItemId,
}: {
  state: ArticleReaderState;
  url: string;
  domain: string;
  audio?: PodcastTrack;
  hnItemId?: number | null;
}) {
  const bookmarked = useFeedBookmarksStore((s) => s.urls.has(url));
  const bookmarkPending = useFeedBookmarksStore((s) => s.pending.has(url));
  const bookmarksLoaded = useFeedBookmarksStore((s) => s.loaded);
  const toggleBookmarkStore = useFeedBookmarksStore((s) => s.toggle);
  const {
    t, article, copied, handleCopyMarkdown, learnMenuOpen, setLearnMenuOpen, learnJob,
    keepLearnMenuOpen, scheduleLearnMenuClose, handleLearnClick, setChatModalSessionId, cancelLearn,
    handleListen, podcastActive, podcastStatus, playerActive, showTranslation, setShowTranslation, setRightView,
    articleId, showComments, setShowComments, comments,
  } = state;

  useEffect(() => {
    if (!bookmarksLoaded) void useFeedBookmarksStore.getState().refresh();
  }, [bookmarksLoaded]);

  const toggleBookmark = async () => {
    if (!article) return;
    await toggleBookmarkStore({
      url,
      title: article.title || url,
      feedTitle: audio?.feedTitle || domain,
      domain,
      summary: article.text_content.slice(0, 300),
      imageUrl: null,
      audioUrl: audio?.audioUrl ?? null,
      audioDuration: null,
      hnItemId: hnItemId ?? null,
      published: new Date().toISOString(),
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => void toggleBookmark()}
        disabled={bookmarkPending}
        title={t(bookmarked ? "feeds.unbookmark" : "feeds.bookmark")}
        aria-label={t(bookmarked ? "feeds.unbookmark" : "feeds.bookmark")}
        aria-pressed={bookmarked}
        className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
          bookmarked
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {bookmarkPending ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
        ) : (
          <BookmarkIcon filled={bookmarked} className="w-4 h-4" />
        )}
      </Button>
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
      <Popover
        open={learnMenuOpen && learnJob?.status === "running"}
        onOpenChange={(open) => {
          if (learnJob?.status === "running") setLearnMenuOpen(open);
        }}
      >
        <PopoverTrigger asChild>
          <span onPointerEnter={keepLearnMenuOpen} onPointerLeave={scheduleLearnMenuClose}>
            <Button
              variant="ghost"
              onClick={handleLearnClick}
              title={
                learnJob?.status === "running" ? t("reader.learnActions")
                : learnJob?.status === "done" ? t("reader.learnOpen")
                : t("reader.learn")
              }
              aria-label={
                learnJob?.status === "running" ? t("reader.learnActions")
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
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          className="w-44 p-1.5"
          onPointerEnter={keepLearnMenuOpen}
          onPointerLeave={scheduleLearnMenuClose}
        >
          <Button
            variant="ghost"
            onClick={() => {
              setLearnMenuOpen(false);
              setChatModalSessionId(learnJob?.sessionId ?? null);
            }}
            className="h-8 w-full justify-start rounded-md px-2.5 text-xs font-medium"
          >
            {t("reader.learnOpen")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setLearnMenuOpen(false);
              cancelLearn(url);
            }}
            className="h-8 w-full justify-start rounded-md px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {t("reader.learnCancel")}
          </Button>
        </PopoverContent>
      </Popover>
      {/* The listen button only exists when a podcast episode is attached —
        * article TTS is desktop-only, and the web reader has no audio for
        * plain text articles. */}
      {audio && (
        <Button
          variant="ghost"
          onClick={handleListen}
          title={t("podcast.listenEpisode")}
          aria-label={t("podcast.listenEpisode")}
          className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
            playerActive
              ? "bg-primary/10 text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          {podcastActive && podcastStatus === "playing" ? (
            <PauseIcon className="w-4 h-4" />
          ) : (
            <PlayIcon className="w-4 h-4" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={() => {
          setShowTranslation((v: boolean) => {
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
          onClick={() => { setShowComments((v: boolean) => { if (!v) setRightView("comments"); return !v; }); }}
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
    </>
  );
}
