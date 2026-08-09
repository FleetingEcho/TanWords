import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { PlayIcon, PauseIcon, MusicIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFill,
  DASHBOARD_ROW_H, DASHBOARD_BODY_ROWS,
} from "./DashboardCard";

/** The now-playing strip is worth two ordinary rows. */
const NOW_PLAYING_ROWS = 2;

function formatDuration(sec: number | null | undefined): string {
  if (!sec || !isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Dashboard card: what to put on next.
 *
 *  Deliberately a picker, not a transport — PodcastPlayerBar already owns
 *  play/pause/seek for whatever is loaded. This card's job is the step before
 *  that: surfacing unplayed episodes from the podcast feeds so starting one is
 *  a single click from the dashboard instead of a trip through Feeds. When
 *  something *is* loaded it pins to the top with its progress, so the card
 *  answers "where was I" and "what's next" in the same place. */
export function ListenNextWidget({ maxRows = DASHBOARD_BODY_ROWS, onInitialDataSettled }: {
  maxRows?: number;
  onInitialDataSettled?: () => void;
}) {
  const t = useT();
  const db = useDB();
  const navigate = useNavStore((s) => s.navigate);
  const status = usePodcastPlayerStore((s) => s.status);
  const track = usePodcastPlayerStore((s) => s.track);
  const position = usePodcastPlayerStore((s) => s.position);
  const duration = usePodcastPlayerStore((s) => s.duration);
  const toggle = usePodcastPlayerStore((s) => s.toggle);
  const play = usePodcastPlayerStore((s) => s.play);

  const [episodes, setEpisodes] = useState<RssEntryRow[] | null>(null);
  const [feedsById, setFeedsById] = useState<Map<number, RssFeed>>(new Map());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [feedList, entries] = await Promise.all([db.getRssFeeds(), db.getRssEntries(null, 120)]);
        if (!alive) return;
        setFeedsById(new Map(feedList.map((f) => [f.id, f])));
        const withAudio = entries.filter((e) => e.audio_url);
        const unheard = withAudio.filter((e) => !e.is_read);
        setEpisodes((unheard.length ? unheard : withAudio).slice(0, maxRows));
      } catch {
        if (!alive) return;
        setFeedsById(new Map());
      } finally {
        if (!alive) return;
        setEpisodes((current) => current ?? []);
        onInitialDataSettled?.();
      }
    })();
    return () => { alive = false; };
  }, [maxRows, onInitialDataSettled]);

  const playing = status === "playing";
  const active = track && status !== "idle";
  const queueRows = Math.max(0, maxRows - (active ? NOW_PLAYING_ROWS : 0));
  const queue = (episodes ?? []).filter((e) => e.audio_url !== track?.audioUrl).slice(0, queueRows);
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <DashboardCard
      title={t("dash.listenNext.title")}
      icon={<MusicIcon className="w-3.5 h-3.5 text-muted-foreground" />}
      onViewAll={() => navigate("feeds")}
    >
      {episodes === null ? (
        <DashboardSkeleton rows={maxRows} />
      ) : !active && queue.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.listenNext")}</DashboardEmpty>
      ) : (
        <>
          {active && (
            <div
              style={{ height: DASHBOARD_ROW_H * NOW_PLAYING_ROWS }}
              className="flex items-center gap-3 px-4 border-b border-border bg-primary/5"
            >
              <Button
                variant="ghost"
                onClick={toggle}
                aria-label={t(playing ? "dash.listenNext.pause" : "dash.listenNext.resume")}
                className="h-9 w-9 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center p-0"
              >
                {playing ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
              </Button>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-foreground truncate">{track.title}</span>
                <span className="block text-[10px] text-muted-foreground truncate">{track.feedTitle}</span>
                <span className="mt-1.5 block h-1 rounded-full bg-muted overflow-hidden">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                </span>
              </span>
            </div>
          )}
          {queue.map((e) => (
            <DashboardRow
              key={e.id}
              onClick={() =>
                play({
                  audioUrl: e.audio_url!,
                  title: e.title,
                  feedTitle: feedsById.get(e.feed_id)?.title ?? "",
                })
              }
            >
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <PlayIcon className="w-2.5 h-2.5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium text-foreground truncate">{e.title}</span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {feedsById.get(e.feed_id)?.title ?? ""}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-mono text-muted-foreground/70">
                {formatDuration(e.audio_duration)}
              </span>
            </DashboardRow>
          ))}
          <DashboardFill />
        </>
      )}
    </DashboardCard>
  );
}
