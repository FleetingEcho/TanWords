import { invoke } from "@tauri-apps/api/core";

/** localStorage mirror, keyed distinctly from the pre-keychain legacy keys
 * (tanwords_openai_key etc., see initProviders.ts's one-time migration).
 * Unsigned/dev Tauri builds on macOS commonly can't write to the OS keychain
 * (missing keychain-access-group entitlement) — every secret_set/secret_get
 * call then fails, silently, every time. Falling back to localStorage here
 * means the app still actually works in that environment instead of forever
 * reporting "no API key configured" no matter how many times the user saves one. */
const FALLBACK_PREFIX = "tanwords_secret_";

/** Get a secret: OS keychain first, falling back to the localStorage mirror
 * if the keychain is unavailable or the entry isn't there. */
export async function getSecret(name: string): Promise<string> {
  try {
    const result = await invoke<string | null>("secret_get", { key: name });
    if (result) return result;
  } catch {
    // keychain unavailable — fall through to localStorage
  }
  return localStorage.getItem(FALLBACK_PREFIX + name) || "";
}

/** Store a secret. Always mirrors to localStorage first (so it works even if
 * the keychain call below fails), then best-effort writes the OS keychain.
 * Empty value clears both. */
export async function setSecret(name: string, value: string): Promise<void> {
  if (value) localStorage.setItem(FALLBACK_PREFIX + name, value);
  else localStorage.removeItem(FALLBACK_PREFIX + name);

  try {
    await invoke("secret_set", { key: name, value });
  } catch (e) {
    // localStorage mirror above already makes this usable — don't fail the
    // caller over a keychain-only problem, just log for diagnosis.
    console.warn(`[secrets] OS keychain write failed for "${name}", using localStorage fallback:`, e);
  }
}

/** Delete a secret from both the localStorage mirror and the OS keychain. */
export async function secretDelete(name: string): Promise<void> {
  localStorage.removeItem(FALLBACK_PREFIX + name);
  try {
    await invoke("secret_delete", { key: name });
  } catch {
    // Silently ignore — may not exist, or keychain unavailable
  }
}
