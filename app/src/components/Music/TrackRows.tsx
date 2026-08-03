import { assetUrl } from "@/ipc/backend";
import { useT } from "@/hooks/useT";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useState } from "react";
import { Film } from "lucide-react";
import { PlayIcon, PauseIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { isVideoFile } from "./mediaKind";
import { VideoPlayerModal } from "./VideoPlayerModal";
import { MusicCollection } from "./types";
import { formatDuration, startQueue } from "./musicLib";

export function TrackRows({
  collection,
  displayName,
  compact = false,
  indices,
}: {
  collection: MusicCollection;
  displayName: string;
  compact?: boolean;
  /** Original track indices to render (search results); defaults to all.
   * Rows keep their original numbering and start the full-collection queue. */
  indices?: number[];
}) {
  const t = useT();
  const currentUrl = usePodcastPlayerStore((s) => s.track?.audioUrl);
  const status = usePodcastPlayerStore((s) => s.status);
  const toggle = usePodcastPlayerStore((s) => s.toggle);

  const shown = indices ? indices.map((i) => ({ tr: collection.tracks[i], i })) : collection.tracks.map((tr, i) => ({ tr, i }));
  const isPlaying = status === "playing" || status === "loading";

  const [video, setVideo] = useState<{ path: string; title: string } | null>(null);

  return (
    <>
      {shown.map(({ tr, i }) => {
        const isCurrent = currentUrl === assetUrl(tr.path) && status !== "idle";
        return (
          <div
            key={tr.path}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (isCurrent) toggle(); else startQueue(collection, displayName, i);
            }}
            // The current row toggles pause/resume; restarting from 0:00 on a
            // click here is never what anyone wants.
            onClick={() => (isCurrent ? toggle() : startQueue(collection, displayName, i))}
            className={`w-full flex items-center gap-4 px-4 rounded-xl text-left transition-colors group ${
              compact ? "py-1.5" : "py-2.5"
            } ${isCurrent ? "bg-primary/10" : "hover:bg-muted"}`}
          >
            <span className={`w-6 text-xs font-mono tabular-nums shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>
              {isCurrent ? (
                <span className="inline-flex items-end gap-[2px] h-3" aria-label={t("music.nowPlaying")}>
                  {[
                    { height: "60%" },
                    { height: "100%", animationDelay: "150ms" },
                    { height: "40%", animationDelay: "300ms" },
                  ].map((style, b) => (
                    <span
                      key={b}
                      className="w-[3px] bg-primary animate-pulse"
                      style={{ ...style, animationPlayState: isPlaying ? "running" : "paused" }}
                    />
                  ))}
                </span>
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-sm truncate ${isCurrent ? "font-semibold text-primary" : "font-medium"}`}>
                {tr.title}
              </span>
              {!compact && tr.artist && <span className="block text-xs text-muted-foreground truncate">{tr.artist}</span>}
            </span>
            {isCurrent ? (
              isPlaying ? (
                <PauseIcon className="w-4 h-4 text-primary shrink-0" />
              ) : (
                <PlayIcon className="w-4 h-4 text-primary shrink-0" />
              )
            ) : (
              <PlayIcon className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
            <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
              {formatDuration(tr.durationSec)}
            </span>
            {/* A video file plays as audio-only through the music pipeline —
              * this opens it where you can actually see it. */}
            {isVideoFile(tr.path) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  // Otherwise the track keeps playing under the video.
                  usePodcastPlayerStore.getState().stop();
                  setVideo({ path: tr.path, title: tr.title });
                }}
                title={t("music.watchVideo")}
                aria-label={t("music.watchVideo")}
                className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
              >
                <Film className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
      <VideoPlayerModal track={video} onClose={() => setVideo(null)} />
    </>
  );
}
