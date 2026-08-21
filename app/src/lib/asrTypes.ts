export interface AsrModelInfo {
  id: string;
  name: string;
  kind: string; // "whisper" | "transducer" | "moonshine" | "unknown"
  path: string;
}

export type AsrDownloadProgress =
  | { phase: "downloading"; received: number; total: number }
  | { phase: "extracting" };
