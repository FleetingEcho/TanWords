import { invoke } from "@tauri-apps/api/core";

/** Get a secret from the OS keychain. Returns empty string if absent. */
export async function getSecret(name: string): Promise<string> {
  try {
    const result = await invoke<string | null>("secret_get", { key: name });
    return result ?? "";
  } catch {
    return "";
  }
}

/** Store a secret in the OS keychain. Empty value deletes the entry. */
export async function setSecret(name: string, value: string): Promise<void> {
  await invoke("secret_set", { key: name, value });
}

/** Delete a secret from the OS keychain. No-op if absent. */
export async function secretDelete(name: string): Promise<void> {
  try {
    await invoke("secret_delete", { key: name });
  } catch {
    // Silently ignore — may not exist
  }
}
