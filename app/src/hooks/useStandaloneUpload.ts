import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { uploadStandaloneAsset } from "@/lib/documentAssets";
import { subscribe } from "@/ipc/events";

/** A blob big enough to matter has to travel to the Postgres primary in one
 *  hrana message, and the server runs out of memory well below the local
 *  100 MB ceiling. The raw error ("Hrana: `stream error: ... SQLITE_NOMEM`")
 *  says nothing a user can act on, so name the actual constraint. */
function explain(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/SQLITE_NOMEM|out of memory|Hrana/i.test(message)) {
    return t("settings.documentAssetsCloudTooLarge");
  }
  return message;
}

/** Uploads files to the standalone asset store (the ones the asset manager
 *  lists and nothing auto-prunes). One file at a time on purpose: a single
 *  rejection — too large, unreadable — reports itself and the rest still land. */
export interface UploadProgress {
  /** 1-based, so it reads as "2 of 5". */
  index: number;
  total: number;
  fileName: string;
  /** Bytes sent for the current file, when the file is going to R2. A
   *  database-bound upload has no byte progress to report. */
  sent: number;
  bytes: number;
}

export function useStandaloneUpload(onUploaded?: () => void) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const uploadFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploading(true);
    let uploaded = 0;
    // Byte-level progress comes from the sidecar as it streams the body to R2
    // (see r2::put_object_with_progress); the database path has none.
    const stop = subscribe<{ fileName: string; sent: number; total: number }>(
      "r2:upload-progress",
      ({ sent, total }) => setProgress((current) => (current ? { ...current, sent, bytes: total } : current)),
    );
    try {
      for (const [index, file] of files.entries()) {
        setProgress({ index: index + 1, total: files.length, fileName: file.name, sent: 0, bytes: file.size });
        try {
          await uploadStandaloneAsset(file);
          uploaded += 1;
        } catch (error) {
          toast.error(`${file.name}: ${explain(error, t)}`);
        }
      }
      if (uploaded > 0) {
        toast.success(t("settings.documentAssetsUploaded", { n: uploaded }));
        onUploaded?.();
      }
    } finally {
      stop();
      setProgress(null);
      setUploading(false);
    }
  };

  return { uploading, progress, uploadFiles };
}
