export interface TtsModelInfo {
  id: string;
  name: string;
  kind: string; // "kokoro" | "piper" | "unknown"
  path: string;
  num_speakers: number;
  voice_names: string[];
}

export type TtsDownloadProgress =
  | { phase: "downloading"; received: number; total: number }
  | { phase: "extracting" };
