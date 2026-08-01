/**
 * Secrets storage — the mobile replacement for the desktop OS keychain
 * (app/core/src/secrets.rs). LLM API keys and the Turso auth token live here
 * and never touch the database, so they never sync off-device.
 */
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/** Stable random id for this device, matching the desktop semantics that
 *  ai_providers rows are `(device_id, id)` scoped and never shared. */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync("tanwords.device_id");
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync("tanwords.device_id", id);
  return id;
}

/** Key under which one AI provider's plaintext API key is stored. */
export function providerSecretKey(deviceId: string, providerId: string): string {
  return `llmkey.${deviceId}.${providerId}`;
}

export const TURSO_URL_KEY = "tanwords.turso_url";
export const TURSO_TOKEN_KEY = "tanwords.turso_token";
