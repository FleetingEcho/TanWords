import React, { useState, useEffect, useRef, useCallback } from "react";
import { registerBuiltInProviders, registerCustomProvider, removeProvider } from "@/providers";
import { getSecret, setSecret, secretDelete } from "@/lib/secrets";
import { useT } from "@/hooks/useT";

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
  const [testStatus, setTestStatus] = useState<string | null>(null);

  // Debounce timers for keychain writes (per key)
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /** Debounced write to keychain. */
  const debouncedSetSecret = useCallback((key: string, value: string) => {
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key]);
    debounceRefs.current[key] = setTimeout(() => {
      setSecret(key, value);
      delete debounceRefs.current[key];
    }, 500);
  }, []);

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

      // Determine initial selected provider
      if (loadedOpenai) setSelectedProvider("openai");
      else if (loadedClaude) setSelectedProvider("claude");
      else if (loadedCustom.some((p) => p.apiKey)) {
        const first = loadedCustom.find((p) => p.apiKey);
        if (first) setSelectedProvider(first.id);
      } else {
        const presetWithKey = Object.entries(presetResult).find(([, v]) => v);
        if (presetWithKey) setSelectedProvider(presetWithKey[0]);
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
    setTestStatus(t("settings.testing"));
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
      setTestStatus(res.ok ? t("settings.testOk") : `❌ ${res.status}`);
    } catch (e: any) {
      setTestStatus(`❌ ${e.message}`);
    }
    setTimeout(() => setTestStatus(null), 3000);
  };

  const addCustom = async () => {
    if (!newProvider.name || !newProvider.apiBase || !newProvider.modelId) return;
    const id = `custom_${Date.now()}`;
    const p = { id, ...newProvider };
    setCustomProviders((prev) => [...prev, p]);
    if (p.apiKey) {
      registerCustomProvider(id, p.name, p.apiBase, p.apiKey, p.modelId);
      await setSecret(`apikey_${id}`, p.apiKey);
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
      await setSecret(`apikey_${editingId}`, editForm.apiKey);
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
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none"
          style={{ background: selectedDot }}
        />
        <select
          value={selectedProvider}
          onChange={(e) => {
            const v = e.target.value;
            setSelectedProvider(v);
            setShowAddCustom(v === "__new__");
          }}
          className="w-full h-10 pl-9 pr-8 rounded-xl border border-input bg-card text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {allCards.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
          ))}
          <option value="__new__">+ {t("settings.custom")}</option>
        </select>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none">
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

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
              <button onClick={() => testConnection("openai", "https://api.openai.com/v1", openaiKey)} className="text-xs text-primary hover:underline">{t("settings.testConnection")}</button>
              {testStatus && <span className="text-xs text-muted-foreground ml-2">{testStatus}</span>}
            </div>
          )}

          {selectedProvider === "claude" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
                <input type="password" value={claudeKey} onChange={(e) => handleClaudeKeyChange(e.target.value)} placeholder="sk-ant-..." className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <button onClick={() => testConnection("claude", "https://api.anthropic.com", claudeKey)} className="text-xs text-primary hover:underline">{t("settings.testConnection")}</button>
              {testStatus && <span className="text-xs text-muted-foreground ml-2">{testStatus}</span>}
            </div>
          )}

          {PRESET_PROVIDERS.map((preset) =>
            selectedProvider === preset.id && (
              <div key={preset.id} className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
                  <input type="password" value={presetKeys[preset.id] || ""} onChange={(e) => handlePresetKeyChange(preset.id, e.target.value)} placeholder="API Key" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <button onClick={() => testConnection(preset.id, preset.apiBase!, presetKeys[preset.id] || "", preset.model)} className="text-xs text-primary hover:underline">{t("settings.testConnection")}</button>
                {testStatus && <span className="text-xs text-muted-foreground ml-2">{testStatus}</span>}
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
                    <input value={editForm.modelId} onChange={(e) => setEditForm((prev) => ({ ...prev, modelId: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="text-xs text-primary hover:underline">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
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
                  <button onClick={() => testConnection(p.id, p.apiBase, p.apiKey, p.modelId)} className="text-xs text-primary hover:underline">{t("settings.testConnection")}</button>
                  {testStatus && <span className="text-xs text-muted-foreground ml-2">{testStatus}</span>}
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => { setEditingId(p.id); setEditForm({ name: p.name, apiBase: p.apiBase, apiKey: p.apiKey, modelId: p.modelId }); }} className="text-xs text-primary hover:underline">Edit</button>
                    <button onClick={() => removeCustom(p.id)} className="text-xs text-destructive hover:underline">Remove</button>
                  </div>
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
            <input value={newProvider.modelId} onChange={(e) => setNewProvider((prev) => ({ ...prev, modelId: e.target.value }))} placeholder="gpt-4o-mini" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={addCustom} disabled={!newProvider.name || !newProvider.apiBase || !newProvider.modelId} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">{t("settings.add")}</button>
            <button onClick={() => setShowAddCustom(false)} className="px-4 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">{t("settings.cancel")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
