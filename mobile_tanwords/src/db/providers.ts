/**
 * AI provider registry — port of app/core/src/db/ai_providers.rs.
 *
 * Same table (`ai_providers`), same per-device scoping (`device_id` PK part,
 * generated per device in SecureStore). Difference vs desktop: instead of
 * AES-256-GCM-encrypted keys under an OS-keychain master key, the plaintext
 * key lives in expo-secure-store and the DB row carries a sentinel.
 */
import { getDb } from "./connection";
import {
  getDeviceId,
  getSecret,
  setSecret,
  deleteSecret,
  providerSecretKey,
} from "@/services/secrets";

const SECURE_STORE_SENTINEL = "__secure_store__";

export interface AiProviderRow {
  id: string;
  name: string;
  kind: string;
  api_base: string;
  model_id: string;
  has_key: boolean;
}

/** Port of command `ai_provider_list`. */
export async function aiProviderList(): Promise<AiProviderRow[]> {
  const deviceId = await getDeviceId();
  const rows = await getDb().getAllAsync<{
    id: string;
    name: string;
    kind: string;
    api_base: string;
    model_id: string;
    api_key_enc: string;
  }>(
    "SELECT id, name, kind, api_base, model_id, api_key_enc FROM ai_providers WHERE device_id = ? ORDER BY created_at",
    [deviceId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    api_base: r.api_base,
    model_id: r.model_id,
    has_key: r.api_key_enc.length > 0,
  }));
}

/** Port of command `ai_provider_upsert`. Omit `apiKey` to preserve the stored
 *  key; pass `""` to clear it. */
export async function aiProviderUpsert(
  p: { id: string; name: string; kind: string; apiBase: string; modelId: string },
  apiKey?: string
): Promise<void> {
  const deviceId = await getDeviceId();
  const db = getDb();
  if (apiKey !== undefined) {
    if (apiKey === "") {
      await deleteSecret(providerSecretKey(deviceId, p.id)).catch(() => {});
    } else {
      await setSecret(providerSecretKey(deviceId, p.id), apiKey);
    }
  }
  await db.runAsync(
    `INSERT INTO ai_providers (device_id, id, name, kind, api_base, model_id, api_key_enc, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(device_id, id) DO UPDATE SET
       name = excluded.name, kind = excluded.kind, api_base = excluded.api_base,
       model_id = excluded.model_id, updated_at = CURRENT_TIMESTAMP
       ${apiKey !== undefined ? ", api_key_enc = excluded.api_key_enc" : ""}`,
    [
      deviceId,
      p.id,
      p.name,
      p.kind,
      p.apiBase,
      p.modelId,
      apiKey !== undefined ? (apiKey === "" ? "" : SECURE_STORE_SENTINEL) : "",
    ]
  );
}

/** Port of command `ai_provider_delete`. */
export async function aiProviderDelete(id: string): Promise<void> {
  const deviceId = await getDeviceId();
  await getDb().runAsync("DELETE FROM ai_providers WHERE device_id = ? AND id = ?", [
    deviceId,
    id,
  ]);
  await deleteSecret(providerSecretKey(deviceId, id)).catch(() => {});
}

/** Port of command `ai_provider_key` — plaintext for actual API calls. */
export async function aiProviderKey(id: string): Promise<string> {
  const deviceId = await getDeviceId();
  return (await getSecret(providerSecretKey(deviceId, id))) ?? "";
}
