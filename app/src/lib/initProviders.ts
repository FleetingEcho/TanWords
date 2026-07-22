import { registerBuiltInProviders, registerCustomProvider } from "@/providers";
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

/**
 * Initialize all AI providers by reading keys from the OS keychain (with
 * localStorage fallback for any keys not yet migrated).
 *
 * Call once at app startup, before any AI features are used.
 */
export async function initProviders(): Promise<void> {
  // Run the migration first (no-op if already done)
  await migrateFromLocalStorage();

  // Load keys from keychain, with localStorage fallback
  const openaiKey =
    (await getSecret("apikey_openai")) ||
    localStorage.getItem("tanwords_openai_key") ||
    "";

  const claudeKey =
    (await getSecret("apikey_claude")) ||
    localStorage.getItem("tanwords_claude_key") ||
    "";

  const providerModels = loadProviderModels();
  registerBuiltInProviders(openaiKey, claudeKey, providerModels);

  // Register preset providers (DeepSeek) from keychain
  const presetProviders = [
    { id: "deepseek", name: "DeepSeek", model: "deepseek-chat", apiBase: "https://api.deepseek.com/v1" },
  ];

  for (const preset of presetProviders) {
    const key =
      (await getSecret(`apikey_${preset.id}`)) ||
      (() => {
        // Fallback: read from legacy localStorage
        try {
          const presetKeys = JSON.parse(
            localStorage.getItem("tanwords_preset_keys") || "{}"
          );
          return presetKeys[preset.id] || "";
        } catch {
          return "";
        }
      })();

    if (key) {
      registerCustomProvider(preset.id, preset.name, preset.apiBase, key, providerModels[preset.id] || preset.model);
    }
  }

  // Register custom providers from localStorage (keys now in keychain)
  try {
    const customProviders = JSON.parse(
      localStorage.getItem("tanwords_custom_providers") || "[]"
    );
    for (const cp of customProviders) {
      const key = await getSecret(`apikey_${cp.id}`);
      registerCustomProvider(cp.id, cp.name, cp.apiBase, key, cp.modelId);
    }
  } catch { /* ignore */ }
}
