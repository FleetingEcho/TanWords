import React, { useState } from "react";
import { openExternal as openShell } from "@/ipc/shell";
import { useT } from "@/hooks/useT";
import { PlayIcon, UpvoteIcon, ReplyIcon, ExternalIcon, TranslateIcon, AnalyzeBackgroundIcon, CheckIcon, BookmarkIcon } from "@/components/ui/icons";
import { StatBadge } from "@/components/ui/StatBadge";
import type { RssEntryRow } from "@/hooks/useDB.types";
import { domainOf, relativeTime, placeholderGradient } from "./feedUtils";
import { Button } from "@/components/ui/button";
import { useLearnChatStore } from "@/store/learnChatStore";

/** Opens the entry's original URL in the system browser, without triggering the card/row's own onOpen (in-app reader). */
function openSource(e: React.MouseEvent, url: string) {
  e.stopPropagation();
  openShell(url).catch(() => window.open(url, "_blank"));
}

/** RssEntryRow plus optional engagement stats (native HN browsing only) —
 *  rendered as icon badges instead of the plain-text summary line. */
export interface DisplayEntry extends RssEntryRow {
  points?: number | null;
  commentCount?: number | null;
}

interface Props {
  entry: DisplayEntry;
  feedTitle: string;
  /** Hero = full-width cover card with the headline set over the image. */
  hero?: boolean;
  onOpen: () => void;
  /** Present only for podcast entries (entry.audio_url set) — starts playback. */
  onPlay?: () => void;
  /** One-click "translate to Chinese" — fetches the article (and comments, if HN) and opens TranslateModal. */
  onTranslate?: () => void;
  /** True while onTranslate's fetch is in flight for this card. */
  translating?: boolean;
  /** Queue this article (and its comments, if HN) for analysis in the background — stays on
   *  this page. Once done, clicking again opens the resulting AI Chat conversation instead. */
  onAnalyzeBackground?: () => void;
  /** True while this card's background analysis is in flight (fetch phase only — the AI call
   *  itself is tracked per-URL in learnChatStore, read directly below for the "done" state). */
  analyzingBackground?: boolean;
  /** Current bookmark state; the button is hidden when the handler is omitted. */
  bookmarked?: boolean;
  bookmarkPending?: boolean;
  onToggleBookmark?: () => void;
  /** Chinese translation of the title (see FeedTabs' "show Chinese titles" toggle) —
   *  shown as a second line under the English title when present. */
  chineseTitle?: string;
  /** False for sources with no real read-tracking (e.g. the live HN browser, which
   *  sets is_read=true just to suppress the dot) — keeps the title at full contrast
   *  instead of dimming everything to the "already read" style. Default true. */
  trackRead?: boolean;
  /** Fixed placeholder-cover background (e.g. a brand color), overriding the
   *  usual hash-of-feedTitle gradient — for sources with a consistent identity. */
  coverColor?: string;
  /** Fixed placeholder-cover letter, overriding the usual first-letter-of-feedTitle —
   *  lets a source show its own initial without feedTitle also taking over the
   *  per-article domain label shown in the meta row. */
  coverLetter?: string;
}

function Cover({ src, feedTitle, className, background, letter }: { src: string | null; feedTitle: string; className: string; background?: string; letter?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} flex items-center justify-center`} style={{ background: background ?? placeholderGradient(feedTitle) }}>
      <span className="font-serif text-5xl font-bold text-white/25 select-none">
        {(letter ?? feedTitle ?? "?").slice(0, 1).toUpperCase() || "?"}
      </span>
    </div>
  );
}

function PlayButton({ onPlay, label }: { onPlay: (e: React.MouseEvent) => void; label: string }) {
  return (
    <Button
      variant="ghost"
      onClick={onPlay}
      className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-xs font-semibold shadow-xs transition-all
        bg-card/90 text-foreground border border-border hover:bg-card
        opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    >
      <PlayIcon className="w-3.5 h-3.5" />
      {label}
    </Button>
  );
}

/** Points/comments badges for entries with engagement stats (native HN browsing).
 *  `tone="onDark"` lightens both for the hero card's photo-overlay text. */
function EngagementBadges({ entry, iconClassName = "w-3 h-3", tone = "default" }: { entry: DisplayEntry; iconClassName?: string; tone?: "default" | "onDark" }) {
  if (entry.points == null && entry.commentCount == null) return null;
  const pointsColor = tone === "onDark" ? "text-orange-300" : "text-orange-600 dark:text-orange-400";
  const commentsColor = tone === "onDark" ? "text-white/80" : "text-muted-foreground";
  return (
    <>
      {entry.points != null && (
        <StatBadge icon={<UpvoteIcon className={iconClassName} />} className={pointsColor}>
          {entry.points}
        </StatBadge>
      )}
      {entry.commentCount != null && (
        <StatBadge icon={<ReplyIcon className={iconClassName} />} className={commentsColor}>
          {entry.commentCount}
        </StatBadge>
      )}
    </>
  );
}

function TranslateButton({ translating, onTranslate, label }: { translating: boolean; onTranslate: (e: React.MouseEvent) => void; label: string }) {
  return (
    <Button
      variant="ghost"
      onClick={onTranslate}
      disabled={translating}
      title={label}
      aria-label={label}
      className="h-8 w-8 p-0 inline-flex items-center justify-center rounded-full shadow-xs transition-all
        bg-card/90 text-foreground border border-border hover:bg-card disabled:opacity-60
        opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    >
      {translating ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      ) : (
        <TranslateIcon className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

function BookmarkButton({ bookmarked, pending = false, onToggle, label, removeLabel }: {
  bookmarked: boolean;
  pending: boolean;
  onToggle: (e: React.MouseEvent) => void;
  label: string;
  removeLabel: string;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onToggle}
      disabled={pending}
      title={bookmarked ? removeLabel : label}
      aria-label={bookmarked ? removeLabel : label}
      aria-pressed={bookmarked}
      className={`h-8 w-8 p-0 inline-flex items-center justify-center rounded-full shadow-xs transition-all border ${
        bookmarked
          ? "bg-primary/10 text-primary border-primary/25 opacity-100"
          : "bg-card/90 text-foreground border-border hover:bg-card"
      }`}
    >
      {pending ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      ) : (
        <BookmarkIcon filled={bookmarked} className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

/** Reads the shared learnChatStore job for this entry's URL — the same store ArticleReader's
 *  "Learn" button uses — so the checkmark survives navigating away and back, and clicking it
 *  once done opens the very chat conversation the background analysis produced. */
function AnalyzeBackgroundButton({ url, analyzing, onAnalyze, analyzeLabel, doneLabel }: {
  url: string;
  analyzing: boolean;
  onAnalyze: (e: React.MouseEvent) => void;
  analyzeLabel: string;
  doneLabel: string;
}) {
  const job = useLearnChatStore((s) => s.jobs[url]);
  const done = job?.status === "done";
  // `analyzing` only covers the initial fetch_article call — the AI generation itself runs
  // as a headless job tracked by URL in learnChatStore, so the spinner needs both to stay
  // lit for the whole operation instead of dropping the instant fetch_article resolves.
  const running = analyzing || job?.status === "running";
  return (
    <Button
      variant="ghost"
      onClick={onAnalyze}
      disabled={running}
      title={done ? doneLabel : analyzeLabel}
      aria-label={done ? doneLabel : analyzeLabel}
      className={`h-8 w-8 p-0 inline-flex items-center justify-center rounded-full shadow-xs transition-all border disabled:opacity-60 ${
        done
          ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-500/90 opacity-100"
          : running
            ? "bg-card/90 text-foreground border-border opacity-100"
            : "bg-card/90 text-foreground border-border hover:bg-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }`}
    >
      {running ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      ) : done ? (
        <CheckIcon className="w-3.5 h-3.5" />
      ) : (
        <AnalyzeBackgroundIcon className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

export function EntryCard({ entry, feedTitle, hero = false, onOpen, onPlay, onTranslate, translating = false, onAnalyzeBackground, analyzingBackground = false, bookmarked = false, bookmarkPending = false, onToggleBookmark, chineseTitle, trackRead = true, coverColor, coverLetter }: Props) {
  const t = useT();
  const unread = trackRead && !entry.is_read;
  const meta = (
    <>
      {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="unread" />}
      <span className="truncate">{feedTitle || domainOf(entry.url)}</span>
      <button
        onClick={(e) => openSource(e, entry.url)}
        title={t("feeds.openSource")}
        aria-label={t("feeds.openSource")}
        className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
      >
        <ExternalIcon className="w-3 h-3" />
      </button>
      <span className="opacity-60">·</span>
      <span className="shrink-0 tabular-nums">{relativeTime(entry.published)}</span>
      {entry.author && (
        <>
          <span className="opacity-60">·</span>
          <span className="truncate">{entry.author}</span>
        </>
      )}
    </>
  );

  const play = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlay?.();
  };

  const translate = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTranslate?.();
  };

  const analyzeBackground = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAnalyzeBackground?.();
  };

  const toggleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleBookmark?.();
  };

  if (hero) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        className="group relative w-full rounded-2xl overflow-hidden cursor-pointer border border-border bg-card
          transition-transform hover:scale-[1.004] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <Cover src={entry.image_url} feedTitle={feedTitle} className="w-full aspect-21/9" background={coverColor} letter={coverLetter} />
        <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/80 mb-1.5">{meta}</div>
          <h3 className="font-serif text-xl md:text-2xl font-bold leading-snug text-white line-clamp-2 text-balance">
            {entry.title}
          </h3>
          {chineseTitle && <p className="mt-1 text-sm text-white/75 line-clamp-2">{chineseTitle}</p>}
          {(entry.points != null || entry.commentCount != null) && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <EngagementBadges entry={entry} tone="onDark" />
            </div>
          )}
          {entry.summary && (
            <p className="mt-1.5 text-xs text-white/70 line-clamp-2 max-w-2xl">{entry.summary}</p>
          )}
        </div>
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {onToggleBookmark && (
            <BookmarkButton
              bookmarked={bookmarked}
              pending={bookmarkPending}
              onToggle={toggleBookmark}
              label={t("feeds.bookmark")}
              removeLabel={t("feeds.unbookmark")}
            />
          )}
          {onPlay && <PlayButton onPlay={play} label={t("feeds.playEpisode")} />}
          {onTranslate && <TranslateButton translating={translating} onTranslate={translate} label={t("feeds.translate")} />}
          {onAnalyzeBackground && (
            <AnalyzeBackgroundButton
              url={entry.url}
              analyzing={analyzingBackground}
              onAnalyze={analyzeBackground}
              analyzeLabel={t("feeds.analyzeBackground")}
              doneLabel={t("feeds.analyzeBackgroundDone")}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="group relative rounded-2xl overflow-hidden cursor-pointer border border-border bg-card flex flex-col
        transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Cover src={entry.image_url} feedTitle={feedTitle} className="w-full aspect-video" background={coverColor} letter={coverLetter} />
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <h3 className={`font-serif text-[15px] leading-snug line-clamp-2 ${!trackRead || !entry.is_read ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>
          {entry.title}
        </h3>
        {chineseTitle && <p className="text-xs text-muted-foreground line-clamp-2">{chineseTitle}</p>}
        {(entry.points != null || entry.commentCount != null) && (
          <div className="flex items-center gap-1.5">
            <EngagementBadges entry={entry} />
          </div>
        )}
        {entry.summary && <p className="text-xs text-muted-foreground line-clamp-2">{entry.summary}</p>}
        <div className="mt-auto pt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">{meta}</div>
      </div>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
        {onToggleBookmark && (
          <BookmarkButton
            bookmarked={bookmarked}
            pending={bookmarkPending}
            onToggle={toggleBookmark}
            label={t("feeds.bookmark")}
            removeLabel={t("feeds.unbookmark")}
          />
        )}
        {onPlay && <PlayButton onPlay={play} label={t("feeds.playEpisode")} />}
        {onTranslate && <TranslateButton translating={translating} onTranslate={translate} label={t("feeds.translate")} />}
        {onAnalyzeBackground && (
          <AnalyzeBackgroundButton
            url={entry.url}
            analyzing={analyzingBackground}
            onAnalyze={analyzeBackground}
            analyzeLabel={t("feeds.analyzeBackground")}
            doneLabel={t("feeds.analyzeBackgroundDone")}
          />
        )}
      </div>
    </div>
  );
}

/** Dense one-line row for list mode — many entries (e.g. a 60-item HN page) at a glance, no cover art. */
export function EntryListRow({ entry, feedTitle, onOpen, onPlay, onTranslate, translating = false, onAnalyzeBackground, analyzingBackground = false, bookmarked = false, bookmarkPending = false, onToggleBookmark, chineseTitle, trackRead = true }: Props) {
  const t = useT();
  const unread = trackRead && !entry.is_read;
  const backgroundJobStatus = useLearnChatStore((s) => s.jobs[entry.url]?.status);
  const backgroundDone = backgroundJobStatus === "done";
  const backgroundRunning = analyzingBackground || backgroundJobStatus === "running";

  const play = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlay?.();
  };

  const translate = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTranslate?.();
  };

  const analyzeBackground = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAnalyzeBackground?.();
  };

  const toggleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleBookmark?.();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      {trackRead && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unread ? "bg-primary" : "bg-transparent"}`} aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <h3 className={`wrap-break-word whitespace-normal text-[13.5px] leading-snug ${unread || !trackRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
          {entry.title}
        </h3>
        {chineseTitle && <p className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground/80">{chineseTitle}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground lg:hidden">
          <span className="max-w-[140px] truncate">{feedTitle || domainOf(entry.url)}</span>
          {(entry.points != null || entry.commentCount != null) && <EngagementBadges entry={entry} />}
          {entry.author && <span className="max-w-[110px] truncate">{entry.author}</span>}
        </div>
      </div>
      {(entry.points != null || entry.commentCount != null) && (
        <span className="hidden md:flex shrink-0 items-center gap-1">
          <EngagementBadges entry={entry} />
        </span>
      )}
      <span className="hidden sm:block shrink-0 max-w-[140px] truncate text-[11px] text-muted-foreground">
        {feedTitle || domainOf(entry.url)}
      </span>
      <button
        onClick={(e) => openSource(e, entry.url)}
        title={t("feeds.openSource")}
        aria-label={t("feeds.openSource")}
        className="hidden sm:flex shrink-0 items-center text-muted-foreground opacity-70 hover:opacity-100 hover:text-foreground transition-colors"
      >
        <ExternalIcon className="w-3 h-3" />
      </button>
      {entry.author && (
        <span className="hidden md:block shrink-0 max-w-[110px] truncate text-[11px] text-muted-foreground/80">
          {entry.author}
        </span>
      )}
      <span className="shrink-0 w-9 text-right text-[11px] font-mono tabular-nums text-muted-foreground">
        {relativeTime(entry.published)}
      </span>
      {onAnalyzeBackground && backgroundDone && (
        <Button
          variant="ghost"
          onClick={analyzeBackground}
          title={t("feeds.analyzeBackgroundDone")}
          aria-label={t("feeds.analyzeBackgroundDone")}
          className="h-6 w-6 p-0 rounded-full flex items-center justify-center shrink-0 text-emerald-500 hover:bg-emerald-500/10 transition-colors"
        >
          <CheckIcon className="w-3 h-3" />
        </Button>
      )}
      <div className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
        bookmarked ? "opacity-100" : "opacity-0"
      } group-hover:opacity-100 focus-within:opacity-100`}>
        {onToggleBookmark && (
          <Button
            variant="ghost"
            onClick={toggleBookmark}
            disabled={bookmarkPending}
            title={bookmarked ? t("feeds.unbookmark") : t("feeds.bookmark")}
            aria-label={bookmarked ? t("feeds.unbookmark") : t("feeds.bookmark")}
            aria-pressed={bookmarked}
            className={`h-6 w-6 p-0 rounded-full flex items-center justify-center transition-colors ${
              bookmarked
                ? "text-primary hover:bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {bookmarkPending ? (
              <span className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
            ) : (
              <BookmarkIcon filled={bookmarked} className="w-3 h-3" />
            )}
          </Button>
        )}
        {onPlay && (
          <Button
            variant="ghost"
            onClick={play}
            title={t("feeds.playEpisode")}
            aria-label={t("feeds.playEpisode")}
            className="h-6 w-6 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <PlayIcon className="w-3 h-3" />
          </Button>
        )}
        {onTranslate && (
          <Button
            variant="ghost"
            onClick={translate}
            disabled={translating}
            title={t("feeds.translate")}
            aria-label={t("feeds.translate")}
            className="h-6 w-6 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {translating ? (
              <span className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
            ) : (
              <TranslateIcon className="w-3 h-3" />
            )}
          </Button>
        )}
        {onAnalyzeBackground && !backgroundDone && (
          <Button
            variant="ghost"
            onClick={analyzeBackground}
            disabled={backgroundRunning}
            title={t("feeds.analyzeBackground")}
            aria-label={t("feeds.analyzeBackground")}
            className="h-6 w-6 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {backgroundRunning ? (
              <span className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
            ) : (
              <AnalyzeBackgroundIcon className="w-3 h-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
