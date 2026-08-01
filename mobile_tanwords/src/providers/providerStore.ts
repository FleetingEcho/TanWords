/** Persistence for AI provider configuration.
 *
 *  Everything lives in the `ai_providers` table — metadata plus a `has_key`
 *  flag. Unlike desktop (AES-256-GCM sealed by the Rust sidecar with a master
 *  key in the OS keychain), the plaintext API key lives in expo-secure-store
 *  and the DB row carries a `__secure_store__` sentinel, so keys never touch
 *  the database and never sync off-device (see src/db/providers.ts).
 *
 *  Rows are still scoped to the device that created them (the backend stamps
 *  and filters on a per-device id from SecureStore), so a shared database
 *  still shows each device only its own providers.
 *
 *  The desktop side of this module also carried a one-time import of the
 *  pre-database localStorage layout (`importLegacyProviderConfig`); mobile is
 *  a fresh install with no such layout, so there is nothing to import. */

import {
  aiProviderDelete,
  aiProviderKey,
  aiProviderList,
  aiProviderUpsert,
} from "@/db/providers";
import {
  markProvidersReady,
  registerBuiltInProviders,
  registerCustomProvider,
} from "./index";
import { DEFAULT_PROVIDER_MODELS } from "./modelPreferences";

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

/** A provider plus its plaintext key, as the UI and the provider registry
 *  need it (both call provider HTTP APIs directly from the app). */
export interface ProviderConfig extends StoredProvider {
  apiKey: string;
}

/** Maps the snake_case row from `aiProviderList` to the camelCase shape the
 *  rest of the JS layer uses. */
function toStoredProvider(row: Awaited<ReturnType<typeof aiProviderList>>[number]): StoredProvider {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    apiBase: row.api_base,
    modelId: row.model_id,
    hasKey: row.has_key,
  };
}

export async function listProviders(): Promise<StoredProvider[]> {
  return (await aiProviderList()).map(toStoredProvider);
}

export async function providerKey(id: string): Promise<string> {
  return aiProviderKey(id);
}

/** Creates or updates a provider. Omit `apiKey` to leave the stored key
 *  untouched (metadata-only saves); pass `""` to clear it. */
export async function upsertProvider(
  provider: Omit<StoredProvider, "hasKey">,
  apiKey?: string,
): Promise<void> {
  // `undefined` means "keep the existing key" — aiProviderUpsert leaves both
  // the SecureStore entry and the api_key_enc column untouched for it.
  await aiProviderUpsert(
    {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      apiBase: provider.apiBase,
      modelId: provider.modelId,
    },
    apiKey,
  );
}

export async function deleteProvider(id: string): Promise<void> {
  await aiProviderDelete(id);
}

/** Every configured provider with its key, keyed by id. The key fetches are
 *  one SecureStore round-trip each, so they overlap rather than run in
 *  sequence. */
export async function loadProviderConfigs(): Promise<Record<string, ProviderConfig>> {
  const rows = await listProviders();
  const keys = await Promise.all(rows.map((row) => (row.hasKey ? providerKey(row.id) : "")));
  const out: Record<string, ProviderConfig> = {};
  rows.forEach((row, i) => {
    out[row.id] = { ...row, apiKey: keys[i] };
  });
  return out;
}

/** Initialize all AI providers from the `ai_providers` table — the mobile
 *  counterpart of desktop's lib/initProviders.ts (folded in here, next to the
 *  only store it reads).
 *
 *  Call once at app startup, before any AI features are used. The registry is
 *  empty until this resolves, so the UI must gate on `areProvidersReady()`
 *  rather than treating "no providers" as "nothing configured". */
export async function initProviders(): Promise<void> {
  try {
    const configs = await loadProviderConfigs();

    // Built-ins are always registered, keyed or not: the settings UI lists
    // them unconditionally, and an unkeyed one simply fails its calls with
    // the API's own error rather than being silently absent.
    registerBuiltInProviders(configs.openai?.apiKey || "", configs.claude?.apiKey || "", {
      openai: configs.openai?.modelId || DEFAULT_PROVIDER_MODELS.openai,
      claude: configs.claude?.modelId || DEFAULT_PROVIDER_MODELS.claude,
    });

    // Presets (e.g. deepseek) and user-defined custom providers alike become
    // CustomProvider instances wrapping their stored base URL and key.
    for (const config of Object.values(configs)) {
      if (config.kind === "builtin" || !config.apiKey) continue;
      registerCustomProvider(config.id, config.name, config.apiBase, config.apiKey, config.modelId);
    }
  } catch (error) {
    // Startup must not hang on a provider problem — surface it and carry on
    // with whatever registered before the failure.
    console.error("[providers] initialization failed:", error);
  } finally {
    // Even a failed init has to unblock the UI — otherwise the AI indicator
    // sits in its loading state forever.
    markProvidersReady();
  }
}
