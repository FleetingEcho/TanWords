/** The model each provider starts on before the user picks one.
 *
 *  On desktop the chosen model is the `model_id` column of that provider's
 *  row in `ai_providers`, so it moves with the rest of its configuration (see
 *  `providerStore.ts`) — that is the primary persistence path on mobile too
 *  (`aiProviderUpsert` in src/db/providers.ts).
 *
 *  Older desktop builds also kept a separate `tanwords_provider_models`
 *  localStorage blob; that path now lives here, persisted through
 *  `user_settings` (via useSettingsStore's getSetting/setSetting) under the
 *  same key name, since there is no localStorage on device. New code should
 *  prefer the `ai_providers` row and treat this as legacy/compat. */

import { useSettingsStore } from "@/store/settingsStore";

const STORAGE_KEY = "tanwords_provider_models";

export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  claude: "claude-haiku-4-5",
  deepseek: "deepseek-chat",
};

export async function loadProviderModels(): Promise<Record<string, string>> {
  try {
    const raw = await useSettingsStore.getState().getSetting(STORAGE_KEY);
    return { ...DEFAULT_PROVIDER_MODELS, ...JSON.parse(raw || "{}") };
  } catch {
    return { ...DEFAULT_PROVIDER_MODELS };
  }
}

export async function saveProviderModel(providerId: string, modelId: string): Promise<void> {
  const models = await loadProviderModels();
  models[providerId] = modelId.trim();
  await useSettingsStore.getState().setSetting(STORAGE_KEY, JSON.stringify(models));
}
