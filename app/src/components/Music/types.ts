export interface MusicTrack {
  path: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
}

export interface MusicCollection {
  name: string;
  tracks: MusicTrack[];
}

export type ViewMode = "cards" | "list";
