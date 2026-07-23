import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { registerBuiltInProviders, registerCustomProvider, removeProvider } from "@/providers";
import { getSecret, setSecret, secretDelete } from "@/lib/secrets";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { loadProviderModels, saveProviderModel } from "@/providers/modelPreferences";
import { BUILT_IN_PROVIDERS, PRESET_PROVIDERS, ProviderDef, loadCustomProvidersMeta, saveCustomProvidersMeta } from "./providerConstants";
import { ProviderPicker } from "./ProviderPicker";
import { ProviderKeyModelPanel } from "./ProviderKeyModelPanel";
import { CustomProviderPanel } from "./CustomProviderPanel";
import { CustomProviderAddForm } from "./CustomProviderAddForm";

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
  const [providerModels, setProviderModels] = useState<Record<string, string>>(() => loadProviderModels());
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
    registerBuiltInProviders(openaiKey, claudeKey, providerModels);
  }, [openaiKey, claudeKey, keysLoaded, providerModels.openai, providerModels.claude]);

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
      if (key) registerCustomProvider(preset.id, preset.name, preset.apiBase, key, providerModels[preset.id] || preset.model);
      else removeProvider(preset.id);
    }
  }, [presetKeys, keysLoaded, providerModels.deepseek]);

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
            model,
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

  const fetchModels = async (providerId: string, apiBase: string, apiKey: string, selectFirst: (model: string) => void, currentModel: string) => {
    if (!apiBase.trim()) return;
    setFetchingModels(true);
    try {
      const base = apiBase.trim().replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey.trim()) {
        if (providerId === "claude") {
          headers["x-api-key"] = apiKey.trim();
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers.Authorization = `Bearer ${apiKey.trim()}`;
        }
      }
      const modelsUrl = providerId === "claude" ? `${base}/v1/models` : `${base}/models`;
      const response = await fetch(modelsUrl, { headers });
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

  const updateProviderModel = (providerId: string, modelId: string) => {
    setProviderModels((current) => ({ ...current, [providerId]: modelId }));
    saveProviderModel(providerId, modelId);
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
    ...BUILT_IN_PROVIDERS.map((provider) => ({ ...provider, model: providerModels[provider.id] || provider.model })),
    ...PRESET_PROVIDERS.map((provider) => ({ ...provider, model: providerModels[provider.id] || provider.model })),
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

      <ProviderPicker
        allCards={allCards}
        selectedProvider={selectedProvider}
        selectedDot={selectedDot}
        fetchedModels={fetchedModels}
        t={t}
        onChange={(v) => {
          setSelectedProvider(v);
          setShowAddCustom(v === "__new__");
          if (v !== "__new__") useSettingsStore.getState().setDefaultAiProvider(v);
        }}
      />

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
            <ProviderKeyModelPanel
              apiKeyValue={openaiKey}
              onApiKeyChange={handleOpenaiKeyChange}
              apiKeyPlaceholder="sk-..."
              modelValue={providerModels.openai || ""}
              onModelChange={(model) => updateProviderModel("openai", model)}
              fetchingModels={fetchingModels}
              onFetchModels={() => void fetchModels("openai", "https://api.openai.com/v1", openaiKey, (model) => updateProviderModel("openai", model), providerModels.openai || "")}
              onTest={() => testConnection("openai", "https://api.openai.com/v1", openaiKey, providerModels.openai)}
              testStatus={testStatus}
              t={t}
            />
          )}

          {selectedProvider === "claude" && (
            <ProviderKeyModelPanel
              apiKeyValue={claudeKey}
              onApiKeyChange={handleClaudeKeyChange}
              apiKeyPlaceholder="sk-ant-..."
              modelValue={providerModels.claude || ""}
              onModelChange={(model) => updateProviderModel("claude", model)}
              fetchingModels={fetchingModels}
              onFetchModels={() => void fetchModels("claude", "https://api.anthropic.com", claudeKey, (model) => updateProviderModel("claude", model), providerModels.claude || "")}
              onTest={() => testConnection("claude", "https://api.anthropic.com", claudeKey, providerModels.claude)}
              testStatus={testStatus}
              t={t}
            />
          )}

          {PRESET_PROVIDERS.map((preset) =>
            selectedProvider === preset.id && (
              <ProviderKeyModelPanel
                key={preset.id}
                apiKeyValue={presetKeys[preset.id] || ""}
                onApiKeyChange={(value) => handlePresetKeyChange(preset.id, value)}
                apiKeyPlaceholder="API Key"
                modelValue={providerModels[preset.id] || ""}
                onModelChange={(model) => updateProviderModel(preset.id, model)}
                fetchingModels={fetchingModels}
                onFetchModels={() => void fetchModels(preset.id, preset.apiBase!, presetKeys[preset.id] || "", (model) => updateProviderModel(preset.id, model), providerModels[preset.id] || "")}
                onTest={() => testConnection(preset.id, preset.apiBase!, presetKeys[preset.id] || "", providerModels[preset.id] || preset.model)}
                testStatus={testStatus}
                t={t}
              />
            )
          )}

          {customProviders.filter((p) => p.id === selectedProvider).map((p) => (
            <CustomProviderPanel
              key={p.id}
              provider={p}
              editingId={editingId}
              editForm={editForm}
              onEditFormChange={setEditForm}
              onSaveEdit={saveEdit}
              onCancelEdit={() => setEditingId(null)}
              onStartEdit={(provider) => { setEditingId(provider.id); setEditForm({ name: provider.name, apiBase: provider.apiBase, apiKey: provider.apiKey, modelId: provider.modelId }); }}
              fetchingModels={fetchingModels}
              onFetchModelsForEdit={() => void fetchModels(p.id, editForm.apiBase, editForm.apiKey, (model) => setEditForm((prev) => ({ ...prev, modelId: model })), editForm.modelId)}
              onTest={(provider) => testConnection(provider.id, provider.apiBase, provider.apiKey, provider.modelId)}
              testStatus={testStatus}
              onRemove={removeCustom}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Custom provider add form */}
      {showAddCustom && (
        <CustomProviderAddForm
          newProvider={newProvider}
          onNewProviderChange={setNewProvider}
          fetchingModels={fetchingModels}
          onFetchModels={() => void fetchModels("custom", newProvider.apiBase, newProvider.apiKey, (model) => setNewProvider((prev) => ({ ...prev, modelId: model })), newProvider.modelId)}
          onAdd={addCustom}
          onCancel={() => setShowAddCustom(false)}
          t={t}
        />
      )}
    </section>
  );
}
