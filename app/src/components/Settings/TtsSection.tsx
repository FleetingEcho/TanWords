import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@/ipc/backend";
import { subscribe } from "@/ipc/events";
import { openDialog } from "@/ipc/dialog";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { markTtsActivity } from "@/lib/ttsBackend";
import { SettingRow } from "./SettingsShared";
import { RecommendedTtsModel } from "@/lib/recommendedTtsModels";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { RecommendedModelsList } from "./RecommendedModelsList";
import { TtsModelInfo, TtsDownloadProgress } from "@/lib/ttsTypes";
import { listProviders, upsertProvider, type StoredProvider } from "@/providers/providerStore";
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

  // ── remote (OpenAI-compatible) engine ───────────────────────────────────
  const [remoteProviders, setRemoteProviders] = useState<StoredProvider[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [form, setForm] = useState({ name: "", apiBase: "", modelId: "", apiKey: "" });

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
    refreshRemoteProviders();
  }, []);

  useEffect(() => {
    return subscribe<TtsDownloadProgress>("tts-download-progress", setProgress);
  }, []);

  const selectModel = async (path: string) => {
    setLoadingPath(path);
    try {
      const info = await invoke<TtsModelInfo>("tts_load_model", { path });
      markTtsActivity();
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

  const refreshRemoteProviders = useCallback(async () => {
    try {
      // Provider rows are device-scoped, keyed by our own "tts" kind so the
      // chat provider section never shows them (it filters builtin/preset/
      // custom only) and this section never shows chat providers.
      const all = await listProviders();
      setRemoteProviders(all.filter((p) => p.kind === "tts"));
    } catch (e) {
      console.warn("ai_provider_list failed", e);
    }
  }, []);

  const selectRemoteProvider = (id: string) => {
    // "" is the "local engine" sentinel — selecting it restores the exact
    // pre-remote behaviour.
    settings.setTtsRemoteProviderId(id);
  };

  const openAddForm = () => {
    setEditingId(null);
    setForm({ name: "", apiBase: "http://127.0.0.1:8024/v1", modelId: "arktts", apiKey: "" });
    setFormOpen(true);
  };

  const openEditForm = (provider: StoredProvider) => {
    setEditingId(provider.id);
    setForm({ name: provider.name, apiBase: provider.apiBase, modelId: provider.modelId, apiKey: "" });
    setFormOpen(true);
  };

  const saveProviderForm = async () => {
    setSavingProvider(true);
    try {
      const id = editingId ?? `tts-${Date.now().toString(36)}`;
      await upsertProvider(
        { id, name: form.name.trim() || id, kind: "tts", apiBase: form.apiBase.trim(), modelId: form.modelId.trim() },
        form.apiKey.trim() ? form.apiKey.trim() : undefined,
      );
      await refreshRemoteProviders();
      settings.setTtsRemoteProviderId(id);
      setFormOpen(false);
    } catch (e) {
      toast.error(t("tts.remote.saveFailed", { error: String(e) }));
    } finally {
      setSavingProvider(false);
    }
  };

  const deleteRemoteProvider = async (provider: StoredProvider) => {
    try {
      await invoke("ai_provider_delete", { id: provider.id });
      if (settings.ttsRemoteProviderId === provider.id) settings.setTtsRemoteProviderId("");
      await refreshRemoteProviders();
    } catch (e) {
      toast.error(t("tts.remote.deleteFailed", { error: String(e) }));
    }
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

      // Clearing `loadedPath` alone only resets this screen. The *persisted*
      // choice has to go too, or ttsBackend's self-heal keeps calling
      // tts_load_model on a directory that no longer exists — once per
      // sentence, silently degrading to webspeech instead of prompting the
      // user to pick again. Compare against the saved path as well as the
      // live one: they diverge whenever the engine failed to load this
      // session.
      if (settings.ttsModelPath === pendingDelete.path) {
        settings.setTtsModelPath("");
        settings.setTtsVoiceId("0");
      }
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
    let url: string | null = null;
    try {
      // Same branch order as lib/ttsBackend.ts: a selected remote provider
      // answers previews too, so the button exercises the configured engine.
      const wavBase64 = settings.ttsRemoteProviderId
        ? await invoke<string>("tts_remote_synthesize", {
            text: t("tts.previewText"),
            speed: 1.0,
          })
        : await invoke<string>("tts_synthesize", {
            text: t("tts.previewText"),
            speakerId: Number(settings.ttsVoiceId) || 0,
            speed: 1.0,
          });
      markTtsActivity();
      const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/wav" });
      url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = settings.ttsSpeed;
      const finish = () => {
        if (url) URL.revokeObjectURL(url);
        url = null;
        setPreviewing(false);
      };
      audio.onended = finish;
      // Without this, a decode/playback failure mid-run leaves `previewing`
      // stuck true (button dead until remount) and the blob URL leaked.
      audio.onerror = finish;
      await audio.play();
    } catch {
      if (url) URL.revokeObjectURL(url);
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
            <SelectTrigger className="h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-hidden max-w-[220px]">
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

      {/* ── remote (OpenAI-compatible) engine ────────────────────────────
          Takes precedence over the local model when one is selected: the
          speech path (lib/ttsBackend.ts) branches on ttsRemoteProviderId
          before ever touching the local engine. */}
      <SettingRow label={t("tts.engine")} sub={t("tts.engineSub")}>
        <div className="flex items-center gap-2">
          <Select
            value={settings.ttsRemoteProviderId || "local"}
            onValueChange={(v) => selectRemoteProvider(v === "local" ? "" : v)}
          >
            <SelectTrigger className="h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-hidden max-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">{t("tts.engine.local")}</SelectItem>
              {remoteProviders.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={openAddForm}
            className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
          >
            {t("tts.remote.add")}
          </Button>
        </div>
      </SettingRow>

      {remoteProviders.length > 0 && (
        <SettingRow label={t("tts.remote")} sub={t("tts.remote.audio8Hint")}>
          <div className="flex flex-col items-end gap-1 max-w-[280px]">
            {remoteProviders.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground truncate max-w-[160px]" title={`${p.apiBase} · ${p.modelId}`}>
                  {p.name} · {p.modelId || "—"}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => openEditForm(p)}
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent transition-colors"
                >
                  {t("tts.remote.edit")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void deleteRemoteProvider(p)}
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive hover:bg-transparent transition-colors"
                >
                  {t("tts.remote.delete")}
                </Button>
              </div>
            ))}
          </div>
        </SettingRow>
      )}

      {settings.ttsRemoteProviderId && (
        <SettingRow label={t("tts.remote.voice")} sub={t("tts.remote.voiceSub")}>
          <input
            type="text"
            value={settings.ttsRemoteVoice}
            placeholder="speaker_a / alloy"
            onChange={(e) => settings.setTtsRemoteVoice(e.target.value)}
            className="w-48 h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </SettingRow>
      )}

      {/* Pocket names its voices (they are reference recordings, not entries in
          a speaker table), so it gets a real picker instead of Kokoro's raw
          speaker-id box. The stored value stays the index either way. */}
      {selected && selected.voice_names.length > 0 && (
        <SettingRow label={t("tts.voice")} sub={t("tts.voiceSub")}>
          <Select
            value={String(Math.min(Number(settings.ttsVoiceId) || 0, selected.voice_names.length - 1))}
            onValueChange={(v) => settings.setTtsVoiceId(v)}
          >
            <SelectTrigger className="h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-hidden max-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selected.voice_names.map((name, i) => (
                <SelectItem key={name} value={String(i)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      )}

      {selected?.kind === "kokoro" && (
        <SettingRow label={t("tts.speakerId")} sub={t("tts.speakerIdSub")}>
          <input
            type="number"
            min={0}
            value={settings.ttsVoiceId}
            onChange={(e) => settings.setTtsVoiceId(String(Math.max(0, Number(e.target.value) || 0)))}
            className="w-16 h-8 px-2 rounded-lg border border-input bg-background text-sm text-center focus:outline-hidden focus:ring-2 focus:ring-primary/30"
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
                settings.ttsSpeed === s ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
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
          disabled={previewing || (!loadedPath && !settings.ttsRemoteProviderId)}
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

      {/* Remote endpoint editor. One small form for name / base URL / model /
          optional key — exactly the fields an OpenAI-compatible speech
          endpoint needs, no more. */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="max-w-md">
        <div className="p-5 flex flex-col gap-4">
          <DialogTitle className="text-base font-semibold text-foreground">
            {t("tts.remote")}
          </DialogTitle>
          <p className="text-xs text-muted-foreground -mt-2">{t("tts.remote.audio8Hint")}</p>

          {([
            ["name", "tts.remote.providerName", "", false],
            ["apiBase", "tts.remote.baseUrl", "tts.remote.baseUrlSub", false],
            ["modelId", "tts.remote.model", "tts.remote.modelSub", false],
            ["apiKey", "tts.remote.apiKey", "", true],
          ] as const).map(([field, labelKey, subKey, isPassword]) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">{t(labelKey)}</span>
              {subKey && <span className="text-[11px] text-muted-foreground">{t(subKey)}</span>}
              <input
                type={isPassword ? "password" : "text"}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="h-8 px-2 rounded-lg border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </label>
          ))}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              className="h-8 px-3 rounded-lg text-xs"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void saveProviderForm()}
              disabled={savingProvider || !form.apiBase.trim()}
              className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {savingProvider ? t("tts.remote.saving") : t("tts.remote.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
