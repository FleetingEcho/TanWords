import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useDB } from "@/hooks/useDB";

/** Wires the macOS tray icon to the app: its Play/Pause/Prev/Next controls
 * drive podcastPlayerStore, its "Refresh RSS" syncs every feed, and the
 * Play/Pause label mirrors playback state as it changes. Mount once. */
export function useTraySync() {
  const db = useDB();

  useEffect(() => {
    const unlistens = [
      listen("tray-toggle-play", () => usePodcastPlayerStore.getState().toggle()),
      listen("tray-prev", () => usePodcastPlayerStore.getState().skip(-1)),
      listen("tray-next", () => usePodcastPlayerStore.getState().skip(1)),
      listen("tray-refresh-rss", async () => {
        const feeds = await db.getRssFeeds();
        await Promise.allSettled(feeds.map((f) => db.syncRssFeed(f.id)));
      }),
    ];
    return () => {
      unlistens.forEach((p) => p.then((unlisten) => unlisten()).catch(() => {}));
    };
  }, [db]);

  useEffect(() => {
    return usePodcastPlayerStore.subscribe((state, prev) => {
      if (state.status === prev.status && state.track === prev.track && state.playlist === prev.playlist) {
        return;
      }
      invoke("tray_update_now_playing", {
        title: state.track?.title ?? null,
        playing: state.status === "playing",
        hasPlaylist: !!state.playlist,
      }).catch(() => {});
    });
  }, []);
}
