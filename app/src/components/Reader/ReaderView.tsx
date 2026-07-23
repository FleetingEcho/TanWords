import React from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useT } from "@/hooks/useT";
import { ArticleReader } from "@/components/Reader/ArticleReader";
import { ExternalIcon } from "@/components/ui/icons";
import type { PodcastTrack } from "@/store/podcastPlayerStore";
import { Button } from "@/components/ui/button";

interface Props {
  url: string;
  title: string;
  domain: string;
  onBack: () => void;
  onOpenExternal: () => void;
  onLearn: (payload: { title: string; text: string; commentsText?: string }) => void;
  /** Podcast episodes: the entry's own audio enclosure, passed through to the reader. */
  audio?: PodcastTrack;
  /** Set when this entry came from an hnrss.org-style feed — shows the HN discussion below the article. */
  hnItemId?: number | null;
}

/** In-app reader mode: top bar (back / title / domain / open-external) over the extracted article. */
export function ReaderView({ url, title, domain, onBack, onOpenExternal, onLearn, audio, hnItemId }: Props) {
  const t = useT();

  const openHnDiscussion = async () => {
    const hnUrl = `https://news.ycombinator.com/item?id=${hnItemId}`;
    try {
      await openShell(hnUrl);
    } catch {
      window.open(hnUrl, "_blank");
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Reader bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
        <Button
          variant="ghost"
          onClick={onBack}
          className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ← {t("hn.reader.back")}
        </Button>
        <div className="w-px h-4 bg-border" />
        {hnItemId != null ? (
          <button
            onClick={openHnDiscussion}
            title={t("hn.reader.openDiscussion")}
            className="flex-1 min-w-0 text-left text-sm font-medium truncate hover:text-primary hover:underline transition-colors"
          >
            {title}
          </button>
        ) : (
          <span className="flex-1 min-w-0 text-sm font-medium truncate">{title}</span>
        )}
        <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
          {domain}
        </span>
        <Button
          variant="ghost"
          onClick={onOpenExternal}
          title={t("hn.reader.external")}
          className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <ExternalIcon className="w-4 h-4" />
        </Button>
      </div>

      <ArticleReader url={url} domain={domain} onOpenExternal={onOpenExternal} onLearn={onLearn} audio={audio} hnItemId={hnItemId} />
    </div>
  );
}
