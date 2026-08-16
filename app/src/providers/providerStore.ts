/** Persistence for AI provider configuration.
 *
 *  Everything lives in the `ai_providers` table now — metadata *and* the API
 *  key, the latter AES-256-GCM sealed by the backend with a master key held in
 *  this device's OS keychain. Previously metadata sat in localStorage and keys
 *  in the keychain, neither of which travels with the database, so a
 *  Turso-synced or copied database came up looking unconfigured.
 *
 *  Rows are scoped to the device that created them (the backend stamps and
 *  filters on a device id from app_config.json), so a shared database still
 *  shows each machine only its own providers. */

import { invoke } from "@/ipc/backend";
import { getSecret, secretDelete } from "@/lib/secrets";
import { BUILT_IN_API_BASE, PRESET_PROVIDERS } from "@/components/Settings/providerConstants";
import { isDesktopHost } from "@/platform";

export type ProviderKind = "builtin" | "preset" | "custom";

/** What the backend returns — deliberately without the key. */
export interface StoredProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  apiBase: string;
  modelId: string;
  hasKey: boolean;
}

/** A provider plus its decrypted key, as the UI and the provider registry
 *  need it (both call provider HTTP APIs directly from the renderer). */
export interface ProviderConfig extends StoredProvider {
  apiKey: string;
}

export async function listProviders(): Promise<StoredProvider[]> {
  return invoke<StoredProvider[]>("ai_provider_list");
}

export async function providerKey(id: string): Promise<string> {
  if (!isDesktopHost) return "";
  return invoke<string>("ai_provider_key", { id });
}

/** Creates or updates a provider. Omit `apiKey` to leave the stored key
 *  untouched (metadata-only saves); pass `""` to clear it. */
export async function upsertProvider(
  provider: Omit<StoredProvider, "hasKey">,
  apiKey?: string,
): Promise<void> {
  await invoke("ai_provider_upsert", {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    apiBase: provider.apiBase,
    modelId: provider.modelId,
    // `undefined` is dropped by JSON.stringify, arriving as the backend's
    // `None` — which is exactly the "keep the existing key" signal.
    apiKey,
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await invoke("ai_provider_delete", { id });
}

/** Every configured provider with its key, keyed by id. The key fetches are
 *  one round-trip each, so they overlap rather than run in sequence. */
export async function loadProviderConfigs(): Promise<Record<string, ProviderConfig>> {
  // TanWords exposes one provider shape: user-defined OpenAI-compatible
  // endpoints. Legacy builtin/preset rows remain stored for safe rollback,
  // but are deliberately inactive and invisible throughout the app.
  const rows = (await listProviders()).filter((row) => row.kind === "custom");
  if (!isDesktopHost) {
    const out: Record<string, ProviderConfig> = {};
    for (const row of rows) {
      out[row.id] = { ...row, apiKey: "" };
    }
    return out;
  }
  const keys = await Promise.all(rows.map((row) => (row.hasKey ? providerKey(row.id) : "")));
  const out: Record<string, ProviderConfig> = {};
  rows.forEach((row, i) => {
    out[row.id] = { ...row, apiKey: keys[i] };
  });
  return out;
}

// ── One-time import from the pre-database layout ───────────────────────────

const IMPORT_FLAG = "tanwords_providers_in_db_v1";

type LegacyCustom = { id: string; name: string; apiBase: string; modelId: string };

function legacyCustomProviders(): LegacyCustom[] {
  try {
    return JSON.parse(localStorage.getItem("tanwords_custom_providers") || "[]");
  } catch {
    return [];
  }
}

function legacyModels(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("tanwords_provider_models") || "{}");
  } catch {
    return {};
  }
}

/** Moves an existing install's providers into the database, once.
 *
 *  Reads the keychain (and its localStorage mirror) via the old `getSecret`
 *  path, writes each provider as a row for *this* device, then removes the old
 *  copies so a key is never left sitting in two places. The flag is only set
 *  after everything succeeded — a partial run (locked keychain, database not
 *  writable yet) retries on the next launch rather than silently losing keys.
 *
 *  Deliberately not destructive on failure: `secretDelete` runs per provider
 *  only after that provider's row is written. */
export async function importLegacyProviderConfig(): Promise<void> {
  if (!isDesktopHost) return;
  if (localStorage.getItem(IMPORT_FLAG)) return;

  const models = legacyModels();

  const migrateOne = async (
    id: string,
    name: string,
    kind: ProviderKind,
    apiBase: string,
    fallbackModel: string,
    legacyPlainKeys: string[] = [],
  ) => {
    const fromSecret = await getSecret(`apikey_${id}`);
    const fromPlain = legacyPlainKeys
      .map((storageKey) => localStorage.getItem(storageKey) || "")
      .find(Boolean);
    const apiKey = fromSecret || fromPlain || "";
    const modelId = models[id] || fallbackModel;

    // A provider with neither a key nor a customised model was never actually
    // configured — importing it would add empty rows to every user's database.
    if (!apiKey && kind !== "custom" && !models[id]) return;

    await upsertProvider({ id, name, kind, apiBase, modelId }, apiKey);
    await secretDelete(`apikey_${id}`);
    legacyPlainKeys.forEach((storageKey) => localStorage.removeItem(storageKey));
  };

  await migrateOne("openai", "OpenAI", "builtin", BUILT_IN_API_BASE.openai, "gpt-4o-mini", [
    "tanwords_openai_key",
  ]);
  await migrateOne("claude", "Claude", "builtin", BUILT_IN_API_BASE.claude, "claude-haiku-4-5", [
    "tanwords_claude_key",
  ]);

  // Preset keys had their own pre-keychain home as a single JSON blob.
  let legacyPresetKeys: Record<string, string> = {};
  try {
    legacyPresetKeys = JSON.parse(localStorage.getItem("tanwords_preset_keys") || "{}");
  } catch { /* ignore parse errors */ }

  for (const preset of PRESET_PROVIDERS) {
    const fromSecret = await getSecret(`apikey_${preset.id}`);
    const apiKey = fromSecret || legacyPresetKeys[preset.id] || "";
    if (!apiKey && !models[preset.id]) continue;
    await upsertProvider(
      {
        id: preset.id,
        name: preset.name,
        kind: "preset",
        apiBase: preset.apiBase,
        modelId: models[preset.id] || preset.model,
      },
      apiKey,
    );
    await secretDelete(`apikey_${preset.id}`);
  }

  for (const custom of legacyCustomProviders()) {
    const apiKey = await getSecret(`apikey_${custom.id}`);
    await upsertProvider(
      {
        id: custom.id,
        name: custom.name,
        kind: "custom",
        apiBase: custom.apiBase,
        modelId: custom.modelId,
      },
      apiKey,
    );
    await secretDelete(`apikey_${custom.id}`);
  }

  localStorage.removeItem("tanwords_preset_keys");
  localStorage.removeItem("tanwords_custom_providers");
  localStorage.removeItem("tanwords_provider_models");
  localStorage.setItem(IMPORT_FLAG, "1");
}
