import { registerBuiltInProviders, registerCustomProvider, markProvidersReady } from "@/providers";
import { loadProviderModels } from "@/providers/modelPreferences";
import { getSecret, setSecret } from "./secrets";

const MIGRATION_FLAG = "tanwords_keychain_migrated_v1";

/**
 * One-time migration: move API keys from localStorage into the OS keychain.
 * Strips the key material from localStorage after successful migration.
 */
async function migrateFromLocalStorage(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return;

  // 1. Migrate built-in provider keys
  const openaiKey = localStorage.getItem("tanwords_openai_key");
  if (openaiKey) {
    await setSecret("apikey_openai", openaiKey);
    localStorage.removeItem("tanwords_openai_key");
  }

  const claudeKey = localStorage.getItem("tanwords_claude_key");
  if (claudeKey) {
    await setSecret("apikey_claude", claudeKey);
    localStorage.removeItem("tanwords_claude_key");
  }

  // 2. Migrate preset keys (e.g. DeepSeek)
  try {
    const presetKeys: Record<string, string> = JSON.parse(
      localStorage.getItem("tanwords_preset_keys") || "{}"
    );
    for (const [id, key] of Object.entries(presetKeys)) {
      if (key) {
        await setSecret(`apikey_${id}`, key);
      }
    }
    localStorage.removeItem("tanwords_preset_keys");
  } catch { /* ignore parse errors */ }

  // 3. Migrate custom provider keys (strip apiKey from stored JSON)
  try {
    const customProviders = JSON.parse(
      localStorage.getItem("tanwords_custom_providers") || "[]"
    );
    for (const cp of customProviders) {
      if (cp.apiKey) {
        await setSecret(`apikey_${cp.id}`, cp.apiKey);
      }
    }
    // Persist custom providers WITHOUT apiKey embedded
    const stripped = customProviders.map(
      ({ apiKey, ...rest }: { apiKey?: string; [key: string]: unknown }) => rest
    );
    localStorage.setItem("tanwords_custom_providers", JSON.stringify(stripped));
  } catch { /* ignore parse errors */ }

  localStorage.setItem(MIGRATION_FLAG, "1");
}

const PRESET_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", model: "deepseek-chat", apiBase: "https://api.deepseek.com/v1" },
];

type CustomProviderMeta = { id: string; name: string; apiBase: string; modelId: string };

function loadCustomProviderMeta(): CustomProviderMeta[] {
  try {
    return JSON.parse(localStorage.getItem("tanwords_custom_providers") || "[]");
  } catch {
    return [];
  }
}

/** Legacy pre-keychain preset keys, kept as a fallback for anything the
 * migration above didn't move. */
function legacyPresetKey(id: string): string {
  try {
    return JSON.parse(localStorage.getItem("tanwords_preset_keys") || "{}")[id] || "";
  } catch {
    return "";
  }
}

/**
 * Initialize all AI providers by reading keys from the OS keychain (with
 * localStorage fallback for any keys not yet migrated).
 *
 * Call once at app startup, before any AI features are used. The registry is
 * empty until this resolves, so the UI must gate on `areProvidersReady()`
 * rather than treating "no providers" as "nothing configured".
 */
export async function initProviders(): Promise<void> {
  try {
    // Run the migration first (no-op if already done)
    await migrateFromLocalStorage();

    const customMeta = loadCustomProviderMeta();

    // Every getSecret is its own IPC round-trip to the OS keychain (on Linux,
    // a D-Bus call to the Secret Service that can block on unlocking the
    // collection). Awaiting them one at a time made startup latency scale with
    // the number of configured providers; they're independent, so overlap them.
    const [openaiSecret, claudeSecret, presetKeys, customKeys] = await Promise.all([
      getSecret("apikey_openai"),
      getSecret("apikey_claude"),
      Promise.all(PRESET_PROVIDERS.map((preset) => getSecret(`apikey_${preset.id}`))),
      Promise.all(customMeta.map((cp) => getSecret(`apikey_${cp.id}`))),
    ]);

    // Keychain first, legacy localStorage second
    const openaiKey = openaiSecret || localStorage.getItem("tanwords_openai_key") || "";
    const claudeKey = claudeSecret || localStorage.getItem("tanwords_claude_key") || "";

    const providerModels = loadProviderModels();
    registerBuiltInProviders(openaiKey, claudeKey, providerModels);

    PRESET_PROVIDERS.forEach((preset, i) => {
      const key = presetKeys[i] || legacyPresetKey(preset.id);
      if (key) {
        registerCustomProvider(preset.id, preset.name, preset.apiBase, key, providerModels[preset.id] || preset.model);
      }
    });

    customMeta.forEach((cp, i) => {
      registerCustomProvider(cp.id, cp.name, cp.apiBase, customKeys[i], cp.modelId);
    });
  } finally {
    // Even a failed init has to unblock the UI — otherwise the AI indicator
    // sits in its loading state forever.
    markProvidersReady();
  }
}
