/** Persistence for AI provider configuration.
 *
 *  Everything lives in the `ai_providers` table — metadata *and* the API key,
 *  the latter AES-256-GCM sealed by the server with a master key that never
 *  leaves it.
 *
 *  Web boundary: keys are write-only from here. The browser can store/replace
 *  a key (upsertProvider's apiKey argument), but saved keys are never sent
 *  back — all AI traffic goes through the same-origin `/api/ai-proxy/<id>`
 *  base, where the server injects the decrypted credential upstream. The
 *  desktop build's keychain migration (importLegacyProviderConfig) does not
 *  run on the web: browsers have no legacy localStorage installs to move. */

import { invoke } from "@/api/client";

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

/** A provider plus its in-form key text. On the web `apiKey` only ever holds
 *  what the user just typed into the settings form ("" = untouched); it is
 *  never populated from the server. */
export interface ProviderConfig extends StoredProvider {
  apiKey: string;
}

export async function listProviders(): Promise<StoredProvider[]> {
  return invoke<StoredProvider[]>("ai_provider_list");
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

/** Every configured provider, keyed by id, WITHOUT keys (see header note).
 *  The key round-trips of the desktop's providerKey() don't exist on web. */
export async function loadProviderConfigs(): Promise<Record<string, ProviderConfig>> {
  const rows = await listProviders();
  const out: Record<string, ProviderConfig> = {};
  for (const row of rows) {
    out[row.id] = { ...row, apiKey: "" };
  }
  return out;
}
