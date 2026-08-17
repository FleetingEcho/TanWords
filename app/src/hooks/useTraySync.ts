import { useEffect } from "react";
import { invoke } from "@/ipc/backend";
import { subscribeAll } from "@/ipc/events";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useNavStore } from "@/store/navStore";
import { useDB } from "@/hooks/useDB";

/** Wires the tray icon to the app: its Play/Pause/Prev/Next rows drive
 *  podcastPlayerStore, "Refresh RSS" syncs every feed, "DeepSeek Harness"
 *  navigates to the DSH page (main already surfaced the window before
 *  emitting this — see tray.ts), and the labels mirror playback state and the
 *  UI language as they change.
 *
 *  The traffic goes both ways because the two sides know different things: the
 *  menu is built in the main process, but what is playing and which language
 *  to render in are only known here. Mount once. */
export function useTraySync() {
  const db = useDB();
  const uiLanguage = useSettingsStore((s) => s.uiLanguage);
  const dshGlobalShortcut = useSettingsStore((s) => s.dshGlobalShortcut);
  const dshIdleStopMinutes = useSettingsStore((s) => s.dshIdleStopMinutes);

  useEffect(() => {
    return subscribeAll({
      "tray://toggle-play": () => usePodcastPlayerStore.getState().toggle(),
      "tray://prev": () => usePodcastPlayerStore.getState().skip(-1),
      "tray://next": () => usePodcastPlayerStore.getState().skip(1),
      "tray://open-dsh": () => useNavStore.getState().navigate("dsh"),
      "tray://open-terminal": () => useNavStore.getState().navigate("terminal"),
      "tray://refresh-rss": async () => {
        const feeds = await db.getRssFeeds();
        // allSettled: one dead feed shouldn't stop the rest from refreshing.
        await Promise.allSettled(feeds.filter((f) => !f.is_paused).map((f) => db.syncRssFeed(f.id)));
      },
    });
  }, [db]);

  useEffect(() => {
    void invoke("tray_set_language", { lang: uiLanguage === "zh" ? "zh" : "en" }).catch(() => {});
  }, [uiLanguage]);

  // Neither setting persists on the main-process side across a relaunch
  // (globalShortcut is registered fresh each boot; the idle-stop timer lives
  // in dshSupervisor's in-memory state) — this mount-and-on-change push is
  // the only thing that ever tells main what Settings currently says, same
  // shape as the language sync above.
  useEffect(() => {
    void invoke("dsh_set_global_shortcut", { accelerator: dshGlobalShortcut }).catch(() => {});
  }, [dshGlobalShortcut]);

  useEffect(() => {
    void invoke("dsh_set_idle_stop_minutes", { minutes: dshIdleStopMinutes }).catch(() => {});
  }, [dshIdleStopMinutes]);

  useEffect(() => {
    const push = (state: ReturnType<typeof usePodcastPlayerStore.getState>) =>
      void invoke("tray_update_now_playing", {
        title: state.track?.title ?? null,
        playing: state.status === "playing",
        hasPlaylist: !!state.playlist,
      }).catch(() => {});

    // Seed once: the tray is built before this mounts, so without this a track
    // already playing from a previous session shows as a bare "Play".
    push(usePodcastPlayerStore.getState());

    return usePodcastPlayerStore.subscribe((state, prev) => {
      if (state.status === prev.status && state.track === prev.track && state.playlist === prev.playlist) {
        return;
      }
      push(state);
    });
  }, []);
}
