import React, { useState, useEffect, useRef, useCallback } from "react";
import { netFetch } from "@/ipc/net";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registerCustomProvider, removeProvider } from "@/providers";
import {
  ProviderConfig,
  deleteProvider,
  loadProviderConfigs,
  upsertProvider,
} from "@/providers/providerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { ProviderDef } from "./providerConstants";
import { ProviderRow } from "./ProviderList";
import { CustomProviderPanel } from "./CustomProviderPanel";
import { CustomProviderAddForm } from "./CustomProviderAddForm";
import { isDesktopHost } from "@/platform";

/** Initial state for a user-created OpenAI-compatible endpoint. */
function blankConfig(id: string): ProviderConfig {
  return {
    id,
    name: "",
    kind: "custom",
    apiBase: "",
    modelId: "",
    hasKey: false,
    apiKey: "",
  };
}

export function ProviderSection() {
  const t = useT();
  // Which row is open. Purely a viewing state: the default provider is set
  // by its own button, so you can inspect a key without switching to it.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Every configured provider, keyed by id — the single source of truth here,
  // loaded from (and written straight back to) the `ai_providers` table.
  const [configs, setConfigs] = useState<Record<string, ProviderConfig>>({});
  const [loaded, setLoaded] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: "", apiBase: "", apiKey: "", modelId: "" });
  // Id the add form's provider will be saved under. Generated when the form
  // opens so "fetch available models" and "add" reference the SAME row — on
  // web the models fetch is proxied by the server against the saved provider,
  // so the draft must be written (and fetched under) one stable id, not a
  // hardcoded "custom" that never exists in the database. Refs (not state):
  // the id only feeds event handlers, and the persisted flag must be readable
  // from the unmount cleanup without re-running effects.
  const draftIdRef = useRef<string | null>(null);
  // Whether the draft was persisted to the database this session (only the
  // web "fetch models" path writes it early) — cancel/unmount then deletes
  // it, so a fetch-then-abandon never leaves an orphan provider behind.
  const draftPersistedRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", apiBase: "", apiKey: "", modelId: "" });
  const [testStatus, setTestStatus] = useState<{ ok: boolean | null; text: string } | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const globalDefaultProvider = useSettingsStore((state) => state.defaultAiProvider);

  // Mirrors `configs` so an event handler can build the next value without
  // doing it inside a setState updater — those run twice under StrictMode, and
  // persisting from in there would double every write.
  const configsRef = useRef<Record<string, ProviderConfig>>({});
  configsRef.current = configs;

  // Debounced database writes, one timer per provider.
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // The write closures behind those timers, so unmount can FLUSH rather than
  // discard a pending edit (pages unmount on navigation — App.tsx).
  const pendingWrites = useRef<Record<string, () => void>>({});

  /** Writes one provider's row. Debounced because the key and model inputs
   * fire per keystroke. Errors surface as a toast rather than leaving the UI
   * looking saved while nothing actually persisted. */
  const persist = useCallback((config: ProviderConfig, immediate = false) => {
    const write = () => {
      delete persistTimers.current[config.id];
      delete pendingWrites.current[config.id];
      upsertProvider(
        {
          id: config.id,
          name: config.name,
          kind: config.kind,
          apiBase: config.apiBase,
          modelId: config.modelId,
        },
        config.apiKey,
      ).catch(() => toast.error(t("settings.keySaveFailed")));
    };
    if (persistTimers.current[config.id]) clearTimeout(persistTimers.current[config.id]);
    if (immediate) write();
    else {
      pendingWrites.current[config.id] = write;
      persistTimers.current[config.id] = setTimeout(write, 500);
    }
  }, [t]);

  /** Applies a patch to one provider in state and schedules the write. */
  const updateConfig = useCallback((id: string, patch: Partial<ProviderConfig>, immediate = false) => {
    const next = { ...(configsRef.current[id] ?? blankConfig(id)), ...patch };
    configsRef.current = { ...configsRef.current, [id]: next };
    setConfigs(configsRef.current);
    persist(next, immediate);
  }, [persist]);

  // Flush pending writes on unmount — closing Settings mid-keystroke used to
  // be enough to lose the last edit. The write behind each timer outlives the
  // component: the loopback HTTP call needs no mounted UI to complete.
  useEffect(() => {
    return () => {
      Object.values(persistTimers.current).forEach(clearTimeout);
      Object.values(pendingWrites.current).forEach((write) => write());
      pendingWrites.current = {};
      // A web draft persisted for a models fetch but never "added" must not
      // linger as a half-configured provider row.
      if (draftPersistedRef.current && draftIdRef.current) {
        void deleteProvider(draftIdRef.current).catch(() => {});
      }
    };
  }, []);

  // Load this device's providers once.
  useEffect(() => {
    (async () => {
      let loadedConfigs: Record<string, ProviderConfig> = {};
      try {
        loadedConfigs = await loadProviderConfigs();
      } catch (error) {
        toast.error(String(error));
      }
      configsRef.current = loadedConfigs;
      setConfigs(loadedConfigs);

      // Repair a default that points at a provider with no key — otherwise
      // every AI call silently falls back to whichever one happens to work.
      const currentDefault = useSettingsStore.getState().defaultAiProvider;
      const isConfigured = (config: ProviderConfig | undefined): boolean => {
        return config?.kind === "custom";
      };
      if (!isConfigured(loadedConfigs[currentDefault])) {
        const firstConfigured = Object.values(loadedConfigs).find(isConfigured)?.id;
        if (firstConfigured) useSettingsStore.getState().setDefaultAiProvider(firstConfigured);
      }

      setLoaded(true);
    })();
  }, []);

  // Keep the in-memory provider registry in step with edits, so a custom
  // endpoint works everywhere else without a restart.
  useEffect(() => {
    if (!loaded) return;
    for (const config of Object.values(configs)) {
      if (!isDesktopHost) {
        registerCustomProvider(config.id, config.name, config.apiBase, "", config.modelId);
      } else {
        registerCustomProvider(config.id, config.name, config.apiBase, config.apiKey, config.modelId, false);
      }
    }
  }, [loaded, configs]);

  const configFor = (id: string): ProviderConfig => configs[id] ?? blankConfig(id);
  const keyFor = (id: string): string => configs[id]?.apiKey || "";

  const testConnection = async (providerId: string, apiBase: string, apiKey: string, modelId?: string) => {
    setTestStatus({ ok: null, text: t("settings.testing") });
    const model = modelId || "gpt-4o-mini";

    try {
      if (!isDesktopHost) {
        const base = `/api/ai-proxy/${encodeURIComponent(providerId)}`;
        const res = await netFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }], max_tokens: 3 }),
        });
        setTestStatus(res.ok ? { ok: true, text: t("settings.testOk") } : { ok: false, text: String(res.status) });
        setTimeout(() => setTestStatus(null), 3000);
        return;
      }

      const base = apiBase.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
      const res = await netFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }], max_tokens: 3 }),
      });
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
      if (!isDesktopHost) {
        const base = `/api/ai-proxy/${encodeURIComponent(providerId)}`;
        const modelsUrl = `${base}/models`;
        const response = await netFetch(modelsUrl, { headers: { Accept: "application/json" } });
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
        return;
      }

      const base = apiBase.trim().replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }
      const modelsUrl = `${base}/models`;
      const response = await netFetch(modelsUrl, { headers });
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
    // Reuse the id the form has been fetching models under, so the draft row
    // the web proxy read from is the row this save finalizes — never a fresh
    // id that would orphan the draft (and its stored key).
    const id = draftIdRef.current ?? `custom_${Date.now()}`;
    draftIdRef.current = null;
    draftPersistedRef.current = false;
    updateConfig(
      id,
      {
        id,
        name: newProvider.name,
        kind: "custom",
        apiBase: newProvider.apiBase,
        modelId: newProvider.modelId,
        apiKey: newProvider.apiKey,
        hasKey: Boolean(newProvider.apiKey),
      },
      true,
    );
    setNewProvider({ name: "", apiBase: "", apiKey: "", modelId: "" });
    setShowAddCustom(false);
    setExpandedId(id);
    // A provider you just took the trouble to add is almost certainly the one
    // you want used. Keyed or keyless — a self-hosted server needs no key —
    // so the default no longer waits for a key to be present.
    useSettingsStore.getState().setDefaultAiProvider(id);
  };

  const openAddForm = () => {
    draftIdRef.current = `custom_${Date.now()}`;
    draftPersistedRef.current = false;
    setShowAddCustom(true);
  };

  const toggleAddForm = () => {
    // Toggle, not "open again": reopening over an open form would mint a new
    // draft id and orphan the previous draft row (and its stored key).
    if (showAddCustom) cancelAddForm();
    else openAddForm();
  };

  const cancelAddForm = () => {
    // On web the "fetch models" step wrote the draft row early (the proxy
    // reads providers server-side); abandoning the form must remove it, or a
    // half-configured provider shows up on the next visit.
    if (draftPersistedRef.current && draftIdRef.current) {
      const id = draftIdRef.current;
      void deleteProvider(id).catch(() => {});
    }
    draftIdRef.current = null;
    draftPersistedRef.current = false;
    setShowAddCustom(false);
  };

  const fetchModelsForNew = async () => {
    const id = draftIdRef.current;
    if (!id || !newProvider.apiBase.trim()) return;
    if (!isDesktopHost) {
      // The proxy injects the key server-side, so the provider must exist
      // (with this form's base URL and key) before models can be listed.
      // Await the write so the fetch cannot race it.
      await upsertProvider(
        {
          id,
          name: newProvider.name || "Custom",
          kind: "custom",
          apiBase: newProvider.apiBase,
          modelId: newProvider.modelId,
        },
        newProvider.apiKey,
      );
      draftPersistedRef.current = true;
    }
    void fetchModels(id, newProvider.apiBase, newProvider.apiKey, (model) => setNewProvider((prev) => ({ ...prev, modelId: model })), newProvider.modelId);
  };

  const removeCustom = async (id: string) => {
    // Cancel any debounced write first, or it would re-create the row it is
    // still holding a copy of moments after the delete lands.
    if (persistTimers.current[id]) {
      clearTimeout(persistTimers.current[id]);
      delete persistTimers.current[id];
    }
    removeProvider(id);
    const { [id]: _removed, ...rest } = configsRef.current;
    configsRef.current = rest;
    setConfigs(rest);
    try {
      await deleteProvider(id);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const saveEdit = () => {
    if (!editingId) return;
    // On web the stored key is never exposed back to the browser (the proxy
    // injects it server-side, see providerStore.loadProviderConfigs), so an
    // empty key field means "leave the stored key alone" — passing "" would
    // silently wipe it. Desktop shows the real key, so "" there still means
    // "clear".
    const nextKey = isDesktopHost ? editForm.apiKey : (editForm.apiKey || undefined);
    updateConfig(
      editingId,
      {
        name: editForm.name,
        apiBase: editForm.apiBase,
        modelId: editForm.modelId,
        apiKey: nextKey,
        hasKey: nextKey ? true : Boolean(configsRef.current[editingId]?.hasKey),
      },
      true,
    );
    setEditingId(null);
  };

  const allCards: ProviderDef[] = [
    ...Object.values(configs)
      .filter((c) => c.kind === "custom")
      .map((c) => ({ id: c.id, name: c.name, model: c.modelId, dot: "#6366f1", isCustom: true, apiBase: c.apiBase })),
  ];

  const panelFor = (id: string) => {
    const config = configFor(id);
    if (!configs[id]) return null;
    return (
      <CustomProviderPanel
        provider={config}
        editingId={editingId}
        editForm={editForm}
        onEditFormChange={setEditForm}
        onSaveEdit={saveEdit}
        onCancelEdit={() => setEditingId(null)}
        onStartEdit={(provider) => { setEditingId(provider.id); setEditForm({ name: provider.name, apiBase: provider.apiBase, apiKey: provider.apiKey, modelId: provider.modelId }); }}
        fetchingModels={fetchingModels}
        onFetchModelsForEdit={() => void fetchModels(config.id, editForm.apiBase, editForm.apiKey, (model) => setEditForm((prev) => ({ ...prev, modelId: model })), editForm.modelId)}
        modelOptions={fetchedModels}
        onTest={(provider) => testConnection(provider.id, provider.apiBase, provider.apiKey, provider.modelId)}
        testStatus={testStatus}
        onRemove={async (removeId) => { await removeCustom(removeId); setExpandedId(null); }}
        t={t}
      />
    );
  };

  return (
    <section>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t("settings.providers")}</p>

      {/* Every provider at once, with its model, whether it has a key, and
        * which one is the default — the old dropdown hid all of that one
        * click deep, and made browsing a config change the default. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {allCards.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            connected={!!keyFor(provider.id)}
            isDefault={provider.id === globalDefaultProvider}
            expanded={expandedId === provider.id}
            onToggleExpanded={() => setExpandedId((current) => (current === provider.id ? null : provider.id))}
            onSetDefault={() => useSettingsStore.getState().setDefaultAiProvider(provider.id)}
            t={t}
          >
            {panelFor(provider.id)}
          </ProviderRow>
        ))}

        <button
          onClick={toggleAddForm}
          className="flex w-full items-center gap-2 border-t border-border/60 px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.addCustomTitle")}
        </button>
      </div>

      {showAddCustom && (
        <CustomProviderAddForm
          newProvider={newProvider}
          onNewProviderChange={setNewProvider}
          fetchingModels={fetchingModels}
          onFetchModels={() => void fetchModelsForNew()}
          modelOptions={fetchedModels}
          onAdd={addCustom}
          onCancel={cancelAddForm}
          t={t}
        />
      )}

    </section>
  );
}
