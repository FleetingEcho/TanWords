import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { registerBuiltInProviders, registerCustomProvider, removeProvider } from "@/providers";
import { getSecret, setSecret, secretDelete } from "@/lib/secrets";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ListRestart, Loader2, Pencil, PlugZap, Trash2, X } from "lucide-react";

function TestStatusBadge({ status }: { status: { ok: boolean | null; text: string } }) {
  return (
    <span className="text-xs text-muted-foreground ml-2 inline-flex items-center gap-1">
      {status.ok === true && <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />}
      {status.ok === false && <XCircleIcon className="w-3.5 h-3.5 text-destructive" />}
      {status.text}
    </span>
  );
}

function ProviderIconButton({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return <Button type="button" variant="ghost" size="icon" onClick={onClick} title={label} aria-label={label} className={`h-8 w-8 rounded-lg ${danger ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>{children}</Button>;
}

interface ProviderDef {
  id: string;
  name: string;
  model: string;
  dot: string;
  isCustom?: boolean;
  apiBase?: string;
}

const BUILT_IN_PROVIDERS: ProviderDef[] = [
  { id: "openai", name: "OpenAI", model: "gpt-4o-mini", dot: "#22c55e" },
  { id: "claude", name: "Claude", model: "haiku-4.5", dot: "#8b5cf6" },
];

const PRESET_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", model: "deepseek-chat", dot: "#3b82f6", apiBase: "https://api.deepseek.com/v1" },
];

function loadCustomProvidersMeta(): { id: string; name: string; apiBase: string; modelId: string }[] {
  try { return JSON.parse(localStorage.getItem("tanwords_custom_providers") || "[]"); } catch { return []; }
}

function saveCustomProvidersMeta(providers: { id: string; name: string; apiBase: string; modelId: string }[]) {
  localStorage.setItem("tanwords_custom_providers", JSON.stringify(providers));
}

export function ProviderSection() {
  const t = useT();
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [openaiKey, setOpenaiKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [customProviders, setCustomProviders] = useState<
    { id: string; name: string; apiBase: string; modelId: string; apiKey: string }[]
  >([]);
  const [presetKeys, setPresetKeys] = useState<Record<string, string>>({});
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: "", apiBase: "", apiKey: "", modelId: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", apiBase: "", apiKey: "", modelId: "" });
  const [testStatus, setTestStatus] = useState<{ ok: boolean | null; text: string } | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const globalDefaultProvider = useSettingsStore((state) => state.defaultAiProvider);

  useEffect(() => {
    if (keysLoaded && globalDefaultProvider) setSelectedProvider(globalDefaultProvider);
  }, [globalDefaultProvider, keysLoaded]);

  // Debounce timers for keychain writes (per key)
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /** Debounced write to keychain. Errors here were previously silent — a
   * failed write (locked/denied keychain) left the UI looking saved while
   * nothing actually persisted, so the key vanished on next launch. */
  const debouncedSetSecret = useCallback((key: string, value: string) => {
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key]);
    debounceRefs.current[key] = setTimeout(() => {
      setSecret(key, value).catch(() => {
        toast.error(t("settings.keySaveFailed"));
      });
      delete debounceRefs.current[key];
    }, 500);
  }, [t]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceRefs.current).forEach(clearTimeout);
    };
  }, []);

  // Load all keys from keychain on mount
  useEffect(() => {
    (async () => {
      const [loadedOpenai, loadedClaude] = await Promise.all([
        getSecret("apikey_openai"),
        getSecret("apikey_claude"),
      ]);
      setOpenaiKey(loadedOpenai);
      setClaudeKey(loadedClaude);

      // Load preset keys (DeepSeek)
      const presetResult: Record<string, string> = {};
      for (const preset of PRESET_PROVIDERS) {
        const key = await getSecret(`apikey_${preset.id}`);
        if (key) presetResult[preset.id] = key;
      }
      setPresetKeys(presetResult);

      // Load custom providers (metadata from localStorage, keys from keychain)
      const metaProviders = loadCustomProvidersMeta();
      const loadedCustom = await Promise.all(
        metaProviders.map(async (m) => {
          const key = await getSecret(`apikey_${m.id}`);
          return { ...m, apiKey: key };
        })
      );
      setCustomProviders(loadedCustom);

      // Determine initial selected provider. Only override the persisted
      // defaultAiProvider if it doesn't actually have a key — otherwise this
      // effect would silently overwrite the user's real choice on every load.
      const currentDefault = useSettingsStore.getState().defaultAiProvider;
      const currentDefaultHasKey =
        (currentDefault === "openai" && loadedOpenai) ||
        (currentDefault === "claude" && loadedClaude) ||
        presetResult[currentDefault] ||
        loadedCustom.find((p) => p.id === currentDefault)?.apiKey;

      if (currentDefaultHasKey) {
        setSelectedProvider(currentDefault);
      } else if (loadedOpenai) {
        setSelectedProvider("openai");
        useSettingsStore.getState().setDefaultAiProvider("openai");
      } else if (loadedClaude) {
        setSelectedProvider("claude");
        useSettingsStore.getState().setDefaultAiProvider("claude");
      } else if (loadedCustom.some((p) => p.apiKey)) {
        const first = loadedCustom.find((p) => p.apiKey);
        if (first) {
          setSelectedProvider(first.id);
          useSettingsStore.getState().setDefaultAiProvider(first.id);
        }
      } else {
        const presetWithKey = Object.entries(presetResult).find(([, v]) => v);
        if (presetWithKey) {
          setSelectedProvider(presetWithKey[0]);
          useSettingsStore.getState().setDefaultAiProvider(presetWithKey[0]);
        }
      }

      setKeysLoaded(true);
    })();
  }, []);

  // Re-register built-in providers when keys change
  useEffect(() => {
    if (!keysLoaded) return;
    registerBuiltInProviders(openaiKey, claudeKey);
  }, [openaiKey, claudeKey, keysLoaded]);

  // Persist + register custom providers
  useEffect(() => {
    if (!keysLoaded) return;
    const meta = customProviders.map(({ id, name, apiBase, modelId }) => ({ id, name, apiBase, modelId }));
    saveCustomProvidersMeta(meta);
    customProviders.forEach((p) => {
      if (p.apiKey) registerCustomProvider(p.id, p.name, p.apiBase, p.apiKey, p.modelId);
    });
  }, [customProviders, keysLoaded]);

  // Register/unregister preset providers
  useEffect(() => {
    if (!keysLoaded) return;
    for (const preset of PRESET_PROVIDERS) {
      const key = presetKeys[preset.id];
      if (key) registerCustomProvider(preset.id, preset.name, preset.apiBase, key, preset.model);
      else removeProvider(preset.id);
    }
  }, [presetKeys, keysLoaded]);

  // Handle built-in key changes: write to keychain (debounced) + re-register
  const handleOpenaiKeyChange = (value: string) => {
    setOpenaiKey(value);
    debouncedSetSecret("apikey_openai", value);
  };

  const handleClaudeKeyChange = (value: string) => {
    setClaudeKey(value);
    debouncedSetSecret("apikey_claude", value);
  };

  const testConnection = async (providerId: string, apiBase: string, apiKey: string, modelId?: string) => {
    setTestStatus({ ok: null, text: t("settings.testing") });
    const model = modelId || "gpt-4o-mini";

    try {
      let res: Response;
      if (providerId === "claude") {
        // Claude uses the Anthropic Messages API, not OpenAI-compatible chat/completions
        const base = apiBase.replace(/\/$/, "");
        res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5",
            max_tokens: 3,
            messages: [{ role: "user", content: "Hi" }],
          }),
        });
      } else {
        const base = apiBase.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }], max_tokens: 3 }),
        });
      }
      setTestStatus(res.ok ? { ok: true, text: t("settings.testOk") } : { ok: false, text: String(res.status) });
    } catch (e: any) {
      setTestStatus({ ok: false, text: e.message });
    }
    setTimeout(() => setTestStatus(null), 3000);
  };

  const fetchModels = async (apiBase: string, apiKey: string, selectFirst: (model: string) => void, currentModel: string) => {
    if (!apiBase.trim()) return;
    setFetchingModels(true);
    try {
      const base = apiBase.trim().replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
      const response = await fetch(`${base}/models`, { headers });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const body = await response.json();
      const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
      const modelIds: string[] = rows
        .map((item: any) => item?.id ?? item?.model ?? item?.name)
        .filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim()));
      const models = [...new Set<string>(modelIds)].sort();
      if (!models.length) throw new Error(t("settings.modelsEmpty"));
      setFetchedModels(models);
      if (!currentModel.trim() || models.length === 1) selectFirst(models[0]);
      toast.success(t("settings.modelsFetched", { count: models.length }));
    } catch (error) {
      toast.error(t("settings.modelsFetchFailed", { error: String(error) }));
    } finally {
      setFetchingModels(false);
    }
  };

  const addCustom = async () => {
    if (!newProvider.name || !newProvider.apiBase || !newProvider.modelId) return;
    const id = `custom_${Date.now()}`;
    const p = { id, ...newProvider };
    setCustomProviders((prev) => [...prev, p]);
    if (p.apiKey) {
      registerCustomProvider(id, p.name, p.apiBase, p.apiKey, p.modelId);
      try {
        await setSecret(`apikey_${id}`, p.apiKey);
      } catch {
        toast.error(t("settings.keySaveFailed"));
      }
    }
    setNewProvider({ name: "", apiBase: "", apiKey: "", modelId: "" });
    setShowAddCustom(false);
  };

  const removeCustom = async (id: string) => {
    removeProvider(id);
    setCustomProviders((prev) => prev.filter((p) => p.id !== id));
    await secretDelete(`apikey_${id}`);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const updated = customProviders.map((p) =>
      p.id === editingId ? { ...p, ...editForm } : p
    );
    setCustomProviders(updated);
    // Persist key to keychain
    if (editForm.apiKey) {
      registerCustomProvider(editingId, editForm.name, editForm.apiBase, editForm.apiKey, editForm.modelId);
      try {
        await setSecret(`apikey_${editingId}`, editForm.apiKey);
      } catch {
        toast.error(t("settings.keySaveFailed"));
      }
    } else {
      registerCustomProvider(editingId, editForm.name, editForm.apiBase, "", editForm.modelId);
    }
    setEditingId(null);
  };

  // Handle preset key changes: update state + keychain
  const handlePresetKeyChange = (presetId: string, value: string) => {
    setPresetKeys((prev) => ({ ...prev, [presetId]: value }));
    debouncedSetSecret(`apikey_${presetId}`, value);
  };

  const allCards: ProviderDef[] = [
    ...BUILT_IN_PROVIDERS,
    ...PRESET_PROVIDERS,
    ...customProviders.map((p) => ({ id: p.id, name: p.name, model: p.modelId, dot: "#6366f1", isCustom: true, apiBase: p.apiBase })),
  ];

  const selectedKey =
    selectedProvider === "openai"
      ? openaiKey
      : selectedProvider === "claude"
        ? claudeKey
        : presetKeys[selectedProvider] ||
          customProviders.find((p) => p.id === selectedProvider)?.apiKey ||
          "";
  const isConnected = !!selectedKey;
  const selectedDot = allCards.find((p) => p.id === selectedProvider)?.dot ?? "#6366f1";

  return (
    <section>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t("settings.providers")}</p>
      <div className="relative w-full max-w-xs">
        <span
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none z-10"
          style={{ background: selectedDot }}
        />
        <Select
          value={selectedProvider}
          onValueChange={(v) => {
            setSelectedProvider(v);
            setShowAddCustom(v === "__new__");
            if (v !== "__new__") useSettingsStore.getState().setDefaultAiProvider(v);
          }}
        >
          <SelectTrigger className="w-full h-10 pl-9 pr-8 rounded-xl border border-input bg-card text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allCards.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} · {p.model}</SelectItem>
            ))}
            <SelectItem value="__new__">+ {t("settings.custom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <datalist id="provider-model-options">{fetchedModels.map((model) => <option key={model} value={model} />)}</datalist>

      {selectedProvider !== "__new__" && (
        <div className="mt-4 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">
              {t("settings.config", { name: allCards.find((p) => p.id === selectedProvider)?.name || selectedProvider })}
            </h3>
            {isConnected && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {t("settings.connected")}
              </span>
            )}
          </div>

          {selectedProvider === "openai" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
                <input type="password" value={openaiKey} onChange={(e) => handleOpenaiKeyChange(e.target.value)} placeholder="sk-..." className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <ProviderIconButton label={t("settings.testConnection")} onClick={() => testConnection("openai", "https://api.openai.com/v1", openaiKey)}><PlugZap className="h-4 w-4" /></ProviderIconButton>
              {testStatus && <TestStatusBadge status={testStatus} />}
            </div>
          )}

          {selectedProvider === "claude" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
                <input type="password" value={claudeKey} onChange={(e) => handleClaudeKeyChange(e.target.value)} placeholder="sk-ant-..." className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <ProviderIconButton label={t("settings.testConnection")} onClick={() => testConnection("claude", "https://api.anthropic.com", claudeKey)}><PlugZap className="h-4 w-4" /></ProviderIconButton>
              {testStatus && <TestStatusBadge status={testStatus} />}
            </div>
          )}

          {PRESET_PROVIDERS.map((preset) =>
            selectedProvider === preset.id && (
              <div key={preset.id} className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
                  <input type="password" value={presetKeys[preset.id] || ""} onChange={(e) => handlePresetKeyChange(preset.id, e.target.value)} placeholder="API Key" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <ProviderIconButton label={t("settings.testConnection")} onClick={() => testConnection(preset.id, preset.apiBase!, presetKeys[preset.id] || "", preset.model)}><PlugZap className="h-4 w-4" /></ProviderIconButton>
                {testStatus && <TestStatusBadge status={testStatus} />}
              </div>
            )
          )}

          {customProviders.filter((p) => p.id === selectedProvider).map((p) => (
            <div key={p.id} className="space-y-3">
              {editingId === p.id ? (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t("settings.name")}</label>
                    <input value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
                    <input value={editForm.apiBase} onChange={(e) => setEditForm((prev) => ({ ...prev, apiBase: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
                    <input type="password" value={editForm.apiKey} onChange={(e) => setEditForm((prev) => ({ ...prev, apiKey: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelId")}</label>
                    <div className="flex gap-2"><input list="provider-model-options" value={editForm.modelId} onChange={(e) => setEditForm((prev) => ({ ...prev, modelId: e.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none" /><ProviderIconButton label={t("settings.fetchModels")} onClick={() => void fetchModels(editForm.apiBase, editForm.apiKey, (model) => setEditForm((prev) => ({ ...prev, modelId: model })), editForm.modelId)}>{fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListRestart className="h-4 w-4" />}</ProviderIconButton></div>
                  </div>
                  <div className="flex gap-2">
                    <ProviderIconButton label={t("settings.save")} onClick={saveEdit}><Check className="h-4 w-4" /></ProviderIconButton>
                    <ProviderIconButton label={t("settings.cancel")} onClick={() => setEditingId(null)}><X className="h-4 w-4" /></ProviderIconButton>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
                    <p className="text-sm font-mono">{p.apiBase}</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t("settings.defaultModel")}</label>
                    <p className="text-sm font-mono">{p.modelId}</p>
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <ProviderIconButton label={t("settings.testConnection")} onClick={() => testConnection(p.id, p.apiBase, p.apiKey, p.modelId)}><PlugZap className="h-4 w-4" /></ProviderIconButton>
                    <ProviderIconButton label={t("settings.edit")} onClick={() => { setEditingId(p.id); setEditForm({ name: p.name, apiBase: p.apiBase, apiKey: p.apiKey, modelId: p.modelId }); }}><Pencil className="h-4 w-4" /></ProviderIconButton>
                    <ProviderIconButton label={t("settings.delete")} danger onClick={() => removeCustom(p.id)}><Trash2 className="h-4 w-4" /></ProviderIconButton>
                  </div>
                  {testStatus && <TestStatusBadge status={testStatus} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Custom provider add form */}
      {showAddCustom && (
        <div className="mt-4 bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold">{t("settings.addCustomTitle")}</h3>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.name")}</label>
            <input value={newProvider.name} onChange={(e) => setNewProvider((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g., Ollama" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
            <input value={newProvider.apiBase} onChange={(e) => setNewProvider((prev) => ({ ...prev, apiBase: e.target.value }))} placeholder="http://localhost:11434/v1" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
            <input type="password" value={newProvider.apiKey} onChange={(e) => setNewProvider((prev) => ({ ...prev, apiKey: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelId")}</label>
            <div className="flex gap-2"><input list="provider-model-options" value={newProvider.modelId} onChange={(e) => setNewProvider((prev) => ({ ...prev, modelId: e.target.value }))} placeholder="gpt-4o-mini" className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none" /><ProviderIconButton label={t("settings.fetchModels")} onClick={() => void fetchModels(newProvider.apiBase, newProvider.apiKey, (model) => setNewProvider((prev) => ({ ...prev, modelId: model })), newProvider.modelId)}>{fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListRestart className="h-4 w-4" />}</ProviderIconButton></div>
          </div>
          <div className="flex gap-2">
            <Button onClick={addCustom} disabled={!newProvider.name || !newProvider.apiBase || !newProvider.modelId} className="h-auto px-4 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">{t("settings.add")}</Button>
            <Button variant="outline" onClick={() => setShowAddCustom(false)} className="h-auto px-4 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">{t("settings.cancel")}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
