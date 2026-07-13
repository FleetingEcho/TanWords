import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { SettingRow } from "./SettingsPage";
import { RecommendedTtsModel } from "@/lib/recommendedTtsModels";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { RecommendedModelsList } from "./RecommendedModelsList";
import { TtsModelInfo, TtsDownloadProgress } from "@/lib/ttsTypes";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SPEEDS = [0.75, 1, 1.25, 1.5];

export function TtsSection() {
  const t = useT();
  const settings = useSettingsStore();
  const [models, setModels] = useState<TtsModelInfo[]>([]);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TtsDownloadProgress | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [defaultModelsDir, setDefaultModelsDir] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TtsModelInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const found = await invoke<TtsModelInfo[]>("tts_scan_models", { extraDirs: settings.ttsExtraDirs });
      setModels(found);
    } catch (e) {
      console.warn("tts_scan_models failed", e);
    } finally {
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ttsExtraDirs]);

  useEffect(() => {
    rescan();
  }, [rescan]);

  useEffect(() => {
    invoke<TtsModelInfo | null>("tts_engine_status")
      .then((status) => setLoadedPath(status?.path ?? null))
      .catch(() => {});
    invoke<string>("tts_default_models_dir")
      .then(setDefaultModelsDir)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<TtsDownloadProgress>("tts-download-progress", (event) => {
      setProgress(event.payload);
    }).catch(() => undefined);
    return () => {
      unlisten.then((f) => f?.());
    };
  }, []);

  const selectModel = async (path: string) => {
    setLoadingPath(path);
    try {
      const info = await invoke<TtsModelInfo>("tts_load_model", { path });
      settings.setTtsModelPath(path);
      settings.setTtsVoiceId("0");
      setLoadedPath(info.path);
    } catch (e) {
      toast.error(t("tts.loadFailed", { error: String(e) }));
    } finally {
      setLoadingPath(null);
    }
  };

  const addDirectory = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    if (settings.ttsExtraDirs.includes(picked)) return;
    settings.setTtsExtraDirs([...settings.ttsExtraDirs, picked]);
  };

  const removeDirectory = (dir: string) => {
    settings.setTtsExtraDirs(settings.ttsExtraDirs.filter((d) => d !== dir));
  };

  const downloadModel = async (model: RecommendedTtsModel) => {
    if (downloadingId) return;
    setDownloadingId(model.id);
    setProgress(null);
    try {
      const info = await invoke<TtsModelInfo>("tts_download_model", { url: model.url, dirname: model.id });
      await rescan();
      await selectModel(info.path);
      toast.success(t("tts.downloadOk"));
    } catch (e) {
      toast.error(t("tts.downloadFailed", { error: String(e) }));
    } finally {
      setDownloadingId(null);
      setProgress(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await invoke("tts_delete_model", { path: pendingDelete.path });
      if (loadedPath === pendingDelete.path) setLoadedPath(null);
      await rescan();
    } catch (e) {
      toast.error(t("tts.deleteFailed", { error: String(e) }));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const wavBase64 = await invoke<string>("tts_synthesize", {
        text: t("tts.previewText"),
        speakerId: Number(settings.ttsVoiceId) || 0,
        speed: 1.0,
      });
      const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = settings.ttsSpeed;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewing(false);
      };
      await audio.play();
    } catch {
      toast.error(t("tts.previewFailed"));
      setPreviewing(false);
    }
  };

  const selected = models.find((m) => m.path === loadedPath) ?? null;

  return (
    <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
      <SettingRow label={t("tts.model")} sub={t("tts.modelSub")}>
        <div className="flex items-center gap-2">
          <Select
            value={loadedPath ?? undefined}
            onValueChange={(v) => selectModel(v)}
            disabled={loadingPath !== null || models.length === 0}
          >
            <SelectTrigger className="h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-none max-w-[220px]">
              <SelectValue placeholder={models.length ? t("tts.model") : t("tts.noModels")} />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.path} value={m.path} disabled={m.kind === "unknown"}>
                  {m.name}
                  {m.kind === "unknown" ? ` ${t("tts.unknownModel")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={rescan}
            disabled={scanning}
            className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("tts.rescan")}
          </Button>
        </div>
      </SettingRow>

      {selected?.kind === "kokoro" && (
        <SettingRow label={t("tts.speakerId")} sub={t("tts.speakerIdSub")}>
          <input
            type="number"
            min={0}
            value={settings.ttsVoiceId}
            onChange={(e) => settings.setTtsVoiceId(String(Math.max(0, Number(e.target.value) || 0)))}
            className="w-16 h-8 px-2 rounded-lg border border-input bg-background text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </SettingRow>
      )}

      <SettingRow label={t("tts.speed")}>
        <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg">
          {SPEEDS.map((s) => (
            <Button
              key={s}
              variant="ghost"
              onClick={() => settings.setTtsSpeed(s)}
              className={`h-auto px-2.5 py-1 rounded-md text-xs font-medium transition-colors hover:bg-transparent ${
                settings.ttsSpeed === s ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}x
            </Button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label={t("tts.preview")}>
        <Button
          onClick={preview}
          disabled={previewing || !loadedPath}
          className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {previewing ? t("tts.previewing") : t("tts.preview")}
        </Button>
      </SettingRow>

      <SettingRow label={t("tts.recommendedModels")} sub={t("tts.recommendedModelsSub")}>
        <RecommendedModelsList
          scannedModels={models}
          defaultModelsDir={defaultModelsDir}
          downloadingId={downloadingId}
          progress={progress}
          onDownload={downloadModel}
          onDeleteRequest={setPendingDelete}
        />
      </SettingRow>

      <SettingRow label={t("tts.addDirectory")}>
        <Button
          variant="outline"
          onClick={addDirectory}
          className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
        >
          {t("tts.addDirectory")}
        </Button>
      </SettingRow>

      {settings.ttsExtraDirs.length > 0 && (
        <SettingRow label={t("tts.directories")}>
          <div className="flex flex-col items-end gap-1 max-w-[280px]">
            {settings.ttsExtraDirs.map((dir) => (
              <div key={dir} className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]" title={dir}>
                  {dir}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => removeDirectory(dir)}
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive hover:bg-transparent transition-colors"
                >
                  {t("tts.removeDirectory")}
                </Button>
              </div>
            ))}
          </div>
        </SettingRow>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("tts.deleteConfirmTitle")}
        message={t("tts.deleteConfirmMessage", { name: pendingDelete?.name ?? "" })}
        confirmLabel={deleting ? t("tts.deleting") : t("tts.delete")}
        confirmDisabled={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
