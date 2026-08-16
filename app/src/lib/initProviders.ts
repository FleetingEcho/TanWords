import { registerCustomProvider, markProvidersReady } from "@/providers";
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
      const rows = (await listProviders()).filter((row) => row.kind === "custom");
      for (const row of rows) {
        registerCustomProvider(row.id, row.name, row.apiBase, "", row.modelId);
      }
      return;
    }

    // No-op after the first successful run. Must precede the load, or an
    // upgrading install reads an empty table and comes up unconfigured.
    await importLegacyProviderConfig();

    const configs = await loadProviderConfigs();

    for (const config of Object.values(configs)) {
      // Custom endpoints may be keyless (Ollama, LM Studio), so every stored
      // custom is registered regardless of whether it carries a credential.
      registerCustomProvider(config.id, config.name, config.apiBase, config.apiKey, config.modelId, false);
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
