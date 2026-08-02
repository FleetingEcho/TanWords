import { registerBuiltInProviders, registerCustomProvider, markProvidersReady } from "@/providers";
import { DEFAULT_PROVIDER_MODELS } from "@/providers/modelPreferences";
import { listProviders } from "@/providers/providerStore";

/**
 * Initialize all AI providers from the `ai_providers` table.
 *
 * Registration is key-less: providers point at `/api/ai-proxy/<id>` and the
 * server injects credentials (see providers/index.ts). What we learn from the
 * table on startup is only *which* providers exist and which model each one
 * uses, so the registry can pre-register them.
 *
 * Call once at app startup, before any AI features are used. The registry is
 * empty until this resolves, so the UI must gate on `areProvidersReady()`
 * rather than treating "no providers" as "nothing configured".
 */
export async function initProviders(): Promise<void> {
  try {
    const rows = await listProviders();
    const byId = new Map(rows.map((row) => [row.id, row]));

    // Built-ins are always registered, keyed or not: the settings UI lists
    // them unconditionally, and an unkeyed one simply fails its calls with
    // the proxy's error rather than being silently absent.
    registerBuiltInProviders("", "", {
      openai: byId.get("openai")?.modelId || DEFAULT_PROVIDER_MODELS.openai,
      claude: byId.get("claude")?.modelId || DEFAULT_PROVIDER_MODELS.claude,
    });

    for (const row of rows) {
      if (row.kind === "builtin") continue;
      registerCustomProvider(row.id, row.name, row.apiBase, "", row.modelId);
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
