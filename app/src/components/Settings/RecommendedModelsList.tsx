import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { RECOMMENDED_TTS_MODELS, RecommendedTtsModel } from "@/lib/recommendedTtsModels";
import { TtsModelInfo, TtsDownloadProgress } from "@/lib/ttsTypes";
import { ChevronIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

function progressLabel(progress: TtsDownloadProgress | null, t: ReturnType<typeof useT>): string {
  if (!progress) return t("tts.downloadingUnknown");
  if (progress.phase === "extracting") return t("tts.extracting");
  if (progress.total > 0) {
    const percent = Math.round((progress.received / progress.total) * 100);
    return t("tts.downloading", { percent });
  }
  return t("tts.downloadingUnknown");
}

const GROUPS: { id: RecommendedTtsModel["group"]; labelKey: string }[] = [
  { id: "kokoro", labelKey: "tts.group.kokoro" },
  { id: "piper", labelKey: "tts.group.piper" },
];

interface Props {
  scannedModels: TtsModelInfo[];
  defaultModelsDir: string;
  downloadingId: string | null;
  progress: TtsDownloadProgress | null;
  onDownload: (model: RecommendedTtsModel) => void;
  onDeleteRequest: (info: TtsModelInfo) => void;
}

/** Compact, grouped list of recommended voice downloads — each row is a
 * single line; the download URL and (once downloaded) local path are tucked
 * behind an expand toggle so the list stays scannable as more entries are
 * added, while still being fully visible (not just a hover tooltip). */
export function RecommendedModelsList({
  scannedModels,
  defaultModelsDir,
  downloadingId,
  progress,
  onDownload,
  onDeleteRequest,
}: Props) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pathCopied, setPathCopied] = useState(false);

  const findDownloaded = (model: RecommendedTtsModel) =>
    scannedModels.find((m) => m.path.endsWith(model.id)) ?? null;

  // Opening the models dir directly often fails (sandboxing / the dir may
  // not exist yet before the first download), so let the user copy the path
  // and navigate to it themselves instead.
  const copyModelsDir = async () => {
    try {
      await navigator.clipboard.writeText(defaultModelsDir);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="flex flex-col gap-2 w-full max-w-md">
      {defaultModelsDir && (
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground min-w-0 truncate">
            {t("tts.modelsDir")}: <span className="font-mono">{defaultModelsDir}</span>
          </p>
          <Button variant="link" onClick={copyModelsDir} className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline shrink-0">
            {pathCopied ? t("tts.pathCopied") : t("tts.copyPath")}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {GROUPS.map((group) => {
          const groupModels = RECOMMENDED_TTS_MODELS.filter((m) => m.group === group.id);
          if (groupModels.length === 0) return null;
          return (
            <div key={group.id} className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-1">
                {t(group.labelKey)}
              </p>
              <div className="flex flex-col gap-1">
                {groupModels.map((model) => {
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
                          {downloaded && (
                            <Button
                              variant="ghost"
                              onClick={() => onDeleteRequest(downloadedInfo)}
                              className="h-6 px-2 rounded-md text-[10.5px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              {t("tts.delete")}
                            </Button>
                          )}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
