import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore, PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { MusicCollection } from "./types";

/** Reads a local track's duration via the same native decoder used for actual
 *  playback (see native_audio_probe_duration) instead of a plain HTML5 `<audio>`
 *  element — WebKit's own demuxer has the same mp4-family duration bugs rodio's
 *  does, so probing with `<audio>` could report no duration for a file that then
 *  plays back (via the native path) with a perfectly correct one. */
export async function probeAudioDuration(path: string): Promise<number | null> {
  try {
    const seconds = await invoke<number>("native_audio_probe_duration", { path });
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

export async function fillMissingDurations(collections: MusicCollection[]): Promise<MusicCollection[]> {
  const result = collections.map((collection) => ({
    ...collection,
    tracks: collection.tracks.map((track) => ({ ...track })),
  }));
  const missing = result.flatMap((collection) =>
    collection.tracks
      .map((track) => ({ track }))
      .filter(({ track }) => track.durationSec === null || !Number.isFinite(track.durationSec) || track.durationSec <= 0)
  );
  let next = 0;

  // Loading metadata still opens each media file, so keep the fallback modest
  // for large libraries instead of asking the OS to inspect everything at once.
  const workers = Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (next < missing.length) {
      const { track } = missing[next++];
      const duration = await probeAudioDuration(track.path);
      if (duration !== null) track.durationSec = duration;
    }
  });
  await Promise.all(workers);
  return result;
}

export function formatDuration(sec: number | null): string {
  if (sec === null || !isFinite(sec) || sec <= 0) return "—";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function toQueue(collection: MusicCollection, displayName: string): PodcastTrack[] {
  return collection.tracks.map((tr) => ({
    audioUrl: convertFileSrc(tr.path),
    localPath: tr.path,
    title: tr.title,
    feedTitle: displayName,
  }));
}

export function startQueue(collection: MusicCollection, displayName: string, index: number, shuffle = false) {
  usePlayerOriginStore.getState().setOrigin({ kind: "music" });
  usePodcastPlayerStore.getState().playQueue(toQueue(collection, displayName), index, shuffle ? "shuffle" : undefined);
}

export async function pickMusicFolder() {
  const picked = await openDialog({ directory: true, multiple: false });
  if (typeof picked === "string") useSettingsStore.getState().setMusicFolderPath(picked);
}
