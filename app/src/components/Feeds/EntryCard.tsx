import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { SparkIcon, PlayIcon } from "@/components/ui/icons";
import type { RssEntryRow } from "@/hooks/useDB.types";
import { domainOf, relativeTime, placeholderGradient } from "./feedUtils";

interface Props {
  entry: RssEntryRow;
  feedTitle: string;
  /** Hero = full-width cover card with the headline set over the image. */
  hero?: boolean;
  /** True while fetch_article runs for this card's Learn action. */
  learning: boolean;
  onOpen: () => void;
  onLearn: () => void;
  /** Present only for podcast entries (entry.audio_url set) — starts playback. */
  onPlay?: () => void;
}

function Cover({ src, feedTitle, className }: { src: string | null; feedTitle: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} flex items-center justify-center`} style={{ background: placeholderGradient(feedTitle) }}>
      <span className="font-serif text-5xl font-bold text-white/25 select-none">
        {(feedTitle || "?").slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}

function PlayButton({ onPlay, label }: { onPlay: (e: React.MouseEvent) => void; label: string }) {
  return (
    <button
      onClick={onPlay}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold shadow-sm transition-all
        bg-card/90 text-foreground border border-border hover:bg-card
        opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    >
      <PlayIcon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function LearnButton({ learning, onLearn, label }: { learning: boolean; onLearn: (e: React.MouseEvent) => void; label: string }) {
  return (
    <button
      onClick={onLearn}
      disabled={learning}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold shadow-sm transition-all
        bg-primary text-primary-foreground hover:bg-primary/90
        ${learning ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
    >
      {learning ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      ) : (
        <SparkIcon className="w-3.5 h-3.5" />
      )}
      {label}
    </button>
  );
}

export function EntryCard({ entry, feedTitle, hero = false, learning, onOpen, onLearn, onPlay }: Props) {
  const t = useT();
  const meta = (
    <>
      {!entry.is_read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="unread" />}
      <span className="truncate">{feedTitle || domainOf(entry.url)}</span>
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

  const learn = (e: React.MouseEvent) => {
    e.stopPropagation();
    onLearn();
  };

  const play = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlay?.();
  };

  if (hero) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        className="group relative w-full rounded-2xl overflow-hidden cursor-pointer border border-border bg-card
          transition-transform hover:scale-[1.004] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <Cover src={entry.image_url} feedTitle={feedTitle} className="w-full aspect-[21/9]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/80 mb-1.5">{meta}</div>
          <h3 className="font-serif text-xl md:text-2xl font-bold leading-snug text-white line-clamp-2 [text-wrap:balance]">
            {entry.title}
          </h3>
          {entry.summary && (
            <p className="mt-1.5 text-xs text-white/70 line-clamp-2 max-w-2xl">{entry.summary}</p>
          )}
        </div>
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {onPlay && <PlayButton onPlay={play} label={t("feeds.playEpisode")} />}
          <LearnButton learning={learning} onLearn={learn} label={t("feeds.learnThis")} />
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
        transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Cover src={entry.image_url} feedTitle={feedTitle} className="w-full aspect-[16/9]" />
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <h3 className={`font-serif text-[15px] leading-snug line-clamp-2 ${entry.is_read ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}`}>
          {entry.title}
        </h3>
        {entry.summary && <p className="text-xs text-muted-foreground line-clamp-2">{entry.summary}</p>}
        <div className="mt-auto pt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">{meta}</div>
      </div>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
        {onPlay && <PlayButton onPlay={play} label={t("feeds.playEpisode")} />}
        <LearnButton learning={learning} onLearn={learn} label={t("feeds.learnThis")} />
      </div>
    </div>
  );
}
