import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { RECOMMENDED_ASR_MODELS, RecommendedAsrModel } from "@/lib/recommendedAsrModels";
import { AsrModelInfo, AsrDownloadProgress } from "@/lib/asrTypes";
import { ChevronIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

function progressLabel(progress: AsrDownloadProgress | null, t: ReturnType<typeof useT>): string {
  if (!progress) return t("tts.downloadingUnknown");
  if (progress.phase === "extracting") return t("tts.extracting");
  if (progress.total > 0) {
    const percent = Math.round((progress.received / progress.total) * 100);
    return t("tts.downloading", { percent });
  }
  return t("tts.downloadingUnknown");
}

interface Props {
  scannedModels: AsrModelInfo[];
  defaultModelsDir: string;
  downloadingId: string | null;
  progress: AsrDownloadProgress | null;
  onDownload: (model: RecommendedAsrModel) => void;
  onDeleteRequest: (info: AsrModelInfo) => void;
}

/** Flat list of the curated ASR downloads — only a handful of entries, so
 *  unlike TTS's `RecommendedModelsList` there is no need for collapsible
 *  groups, just per-row expand for the URL/local path. */
export function RecommendedAsrModelsList({
  scannedModels,
  defaultModelsDir,
  downloadingId,
  progress,
  onDownload,
  onDeleteRequest,
}: Props) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const findDownloaded = (model: RecommendedAsrModel) =>
    scannedModels.find((m) => m.path.endsWith(model.id)) ?? null;

  return (
    <div className="flex flex-col gap-1 w-full max-w-md">
      {RECOMMENDED_ASR_MODELS.map((model) => {
        const downloadedInfo = findDownloaded(model);
        const downloaded = downloadedInfo !== null;
        const isThisDownloading = downloadingId === model.id;
        const expanded = expandedId === model.id;
        const localPath = defaultModelsDir ? `${defaultModelsDir}/${model.id}` : model.id;

        return (
          <div key={model.id} className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <Button
                variant="ghost"
                onClick={() => setExpandedId(expanded ? null : model.id)}
                className="h-auto flex items-center justify-start gap-1.5 min-w-0 flex-1 text-left"
              >
                <ChevronIcon
                  direction="right"
                  className={`w-3 h-3 text-muted-foreground/50 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                />
                <span className="min-w-0">
                  <span className="text-xs font-medium truncate block">{model.name}</span>
                  <span className="text-[10.5px] text-muted-foreground truncate block">
                    {t(model.descriptionKey)} · ~{model.sizeMb}MB
                  </span>
                </span>
              </Button>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  onClick={() => onDownload(model)}
                  disabled={downloadingId !== null || downloaded}
                  className="h-6 px-2 rounded-md text-[10.5px] font-medium border border-input hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {downloaded
                    ? t("tts.alreadyDownloaded")
                    : isThisDownloading
                      ? progressLabel(progress, t)
                      : t("tts.download")}
                </Button>
                {downloaded && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteRequest(downloadedInfo)}
                    title={t("tts.deleteModel", { name: model.name })}
                    aria-label={t("tts.deleteModel", { name: model.name })}
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {expanded && (
              <div className="px-2.5 pb-2 pt-1.5 border-t border-border/60 space-y-1 bg-muted/20">
                <p className="text-[10px] font-mono text-muted-foreground/60 break-all">{model.url}</p>
                {downloaded && (
                  <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 break-all">
                    → {localPath}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
