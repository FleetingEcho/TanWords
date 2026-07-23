import { convertFileSrc } from "@tauri-apps/api/core";
import { toPlayableSrc } from "@/lib/localAudioSrc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore, PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { MusicCollection } from "./types";

export async function probeAudioDuration(path: string): Promise<number | null> {
  let blobUrl: string | null = null;
  try {
    blobUrl = await toPlayableSrc(convertFileSrc(path));
  } catch {
    return null;
  }
  const src = blobUrl;
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.removeAttribute("src");
      audio.load();
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(null), 10_000);

    audio.preload = "metadata";
    audio.addEventListener(
      "loadedmetadata",
      () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null),
      { once: true }
    );
    audio.addEventListener("error", () => finish(null), { once: true });
    audio.src = src;
  });
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
