import { registerBuiltInProviders, registerCustomProvider, markProvidersReady } from "@/providers";
import { DEFAULT_PROVIDER_MODELS } from "@/providers/modelPreferences";
import { importLegacyProviderConfig, loadProviderConfigs } from "@/providers/providerStore";
import { listProviders } from "@/providers/providerStore";
import { isDesktopHost } from "@/platform";

/**
 * Initialize all AI providers from the `ai_providers` table.
 *
 * Call once at app startup, before any AI features are used. The registry is
 * empty until this resolves, so the UI must gate on `areProvidersReady()`
 * rather than treating "no providers" as "nothing configured".
 */
export async function initProviders(): Promise<void> {
  try {
    if (!isDesktopHost) {
      const rows = await listProviders();
      const byId = new Map(rows.map((row) => [row.id, row]));
      registerBuiltInProviders("", "", {
        openai: byId.get("openai")?.modelId || DEFAULT_PROVIDER_MODELS.openai,
        claude: byId.get("claude")?.modelId || DEFAULT_PROVIDER_MODELS.claude,
      });
      for (const row of rows) {
        if (row.kind === "builtin") continue;
        registerCustomProvider(row.id, row.name, row.apiBase, "", row.modelId);
      }
      return;
    }

    // No-op after the first successful run. Must precede the load, or an
    // upgrading install reads an empty table and comes up unconfigured.
    await importLegacyProviderConfig();

    const configs = await loadProviderConfigs();

    // Built-ins are always registered, keyed or not: the settings UI lists
    // them unconditionally, and an unkeyed one simply fails its calls with
    // the API's own error rather than being silently absent.
    registerBuiltInProviders(configs.openai?.apiKey || "", configs.claude?.apiKey || "", {
      openai: configs.openai?.modelId || DEFAULT_PROVIDER_MODELS.openai,
      claude: configs.claude?.modelId || DEFAULT_PROVIDER_MODELS.claude,
    });

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
