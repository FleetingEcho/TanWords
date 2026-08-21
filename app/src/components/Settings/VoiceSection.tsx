import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { subscribe } from "@/ipc/events";
import { openDialog } from "@/ipc/dialog";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { markAsrActivity, transcribeWav } from "@/lib/asrBackend";
import { PcmRecorder, MicPermissionError } from "@/lib/voiceRecorder";
import { SettingRow } from "./SettingsShared";
import { RecommendedAsrModel } from "@/lib/recommendedAsrModels";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { RecommendedAsrModelsList } from "./RecommendedAsrModelsList";
import { AsrModelInfo, AsrDownloadProgress } from "@/lib/asrTypes";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isDesktopHost } from "@/platform";

export function VoiceSection() {
  const t = useT();
  const settings = useSettingsStore();
  const [models, setModels] = useState<AsrModelInfo[]>([]);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<AsrDownloadProgress | null>(null);
  const [defaultModelsDir, setDefaultModelsDir] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AsrModelInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testRecording, setTestRecording] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const found = await invoke<AsrModelInfo[]>("asr_scan_models", { extraDirs: settings.asrExtraDirs });
      setModels(found);
    } catch (e) {
      console.warn("asr_scan_models failed", e);
    } finally {
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.asrExtraDirs]);

  useEffect(() => {
    rescan();
  }, [rescan]);

  useEffect(() => {
    invoke<AsrModelInfo | null>("asr_engine_status")
      .then((status) => setLoadedPath(status?.path ?? null))
      .catch(() => {});
    invoke<string>("asr_default_models_dir")
      .then(setDefaultModelsDir)
      .catch(() => {});
  }, []);

  useEffect(() => {
    return subscribe<AsrDownloadProgress>("asr-download-progress", setProgress);
  }, []);

  const selectModel = async (path: string) => {
    setLoadingPath(path);
    try {
      const info = await invoke<AsrModelInfo>("asr_load_model", { path });
      markAsrActivity();
      settings.setAsrModelPath(path);
      setLoadedPath(info.path);
    } catch (e) {
      toast.error(t("voice.loadFailed", { error: String(e) }));
    } finally {
      setLoadingPath(null);
    }
  };

  const addDirectory = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    if (settings.asrExtraDirs.includes(picked)) return;
    settings.setAsrExtraDirs([...settings.asrExtraDirs, picked]);
  };

  const removeDirectory = (dir: string) => {
    settings.setAsrExtraDirs(settings.asrExtraDirs.filter((d) => d !== dir));
  };

  const downloadModel = async (model: RecommendedAsrModel) => {
    if (downloadingId) return;
    setDownloadingId(model.id);
    setProgress(null);
    try {
      const info = await invoke<AsrModelInfo>("asr_download_model", { url: model.url, dirname: model.id });
      await rescan();
      await selectModel(info.path);
      toast.success(t("voice.downloadOk"));
    } catch (e) {
      toast.error(t("voice.downloadFailed", { error: String(e) }));
    } finally {
      setDownloadingId(null);
      setProgress(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await invoke("asr_delete_model", { path: pendingDelete.path });
      if (settings.asrModelPath === pendingDelete.path) settings.setAsrModelPath("");
      if (loadedPath === pendingDelete.path) setLoadedPath(null);
      await rescan();
    } catch (e) {
      toast.error(t("voice.deleteFailed", { error: String(e) }));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const toggleTestRecording = async () => {
    if (testRecording) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setTestRecording(false);
      setTestBusy(true);
      try {
        const wavBase64 = await recorder!.stop();
        const text = await transcribeWav(wavBase64);
        setTestResult(text || t("voice.testEmpty"));
      } catch (e) {
        setTestResult(e instanceof MicPermissionError ? t("voice.micSilent") : t("voice.recordFailed"));
      } finally {
        setTestBusy(false);
      }
      return;
    }

    setTestResult(null);
    const recorder = new PcmRecorder();
    try {
      await recorder.start();
      recorderRef.current = recorder;
      setTestRecording(true);
    } catch {
      toast.error(t("voice.micFailed"));
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
      <SettingRow label={t("voice.model")} sub={t("voice.modelSub")}>
        <div className="flex items-center gap-2">
          <Select
            value={loadedPath ?? undefined}
            onValueChange={(v) => selectModel(v)}
            disabled={loadingPath !== null || models.length === 0}
          >
            <SelectTrigger className="h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-hidden max-w-[220px]">
              <SelectValue placeholder={models.length ? t("voice.model") : t("voice.noModels")} />
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

      <SettingRow label={t("voice.testRecording")} sub={t("voice.testRecordingSub")}>
        <div className="flex flex-col items-end gap-1 max-w-[280px]">
          <Button
            onClick={toggleTestRecording}
            disabled={testBusy || !loadedPath}
            className={`h-8 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
              testRecording
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {testRecording ? t("voice.stopAndTranscribe") : testBusy ? t("voice.transcribing") : t("voice.startTest")}
          </Button>
          {testResult && <p className="text-[11px] text-muted-foreground text-right">{testResult}</p>}
        </div>
      </SettingRow>

      <SettingRow label={t("voice.recommendedModels")} sub={t("voice.recommendedModelsSub")}>
        <RecommendedAsrModelsList
          scannedModels={models}
          defaultModelsDir={defaultModelsDir}
          downloadingId={downloadingId}
          progress={progress}
          onDownload={downloadModel}
          onDeleteRequest={setPendingDelete}
        />
      </SettingRow>

      {/* A hosted server's filesystem isn't something a web user should be
          pointed at — this "browse the server's other folders" affordance
          only makes sense when the caller already owns the machine. */}
      {isDesktopHost && (
        <SettingRow label={t("tts.addDirectory")}>
          <Button
            variant="outline"
            onClick={addDirectory}
            className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
          >
            {t("tts.addDirectory")}
          </Button>
        </SettingRow>
      )}

      {isDesktopHost && settings.asrExtraDirs.length > 0 && (
        <SettingRow label={t("tts.directories")}>
          <div className="flex flex-col items-end gap-1 max-w-[280px]">
            {settings.asrExtraDirs.map((dir) => (
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
        title={t("voice.deleteConfirmTitle")}
        message={t("voice.deleteConfirmMessage", { name: pendingDelete?.name ?? "" })}
        confirmLabel={deleting ? t("tts.deleting") : t("tts.delete")}
        confirmDisabled={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
