const STORAGE_KEY = "tanwords_provider_models";

export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  claude: "claude-haiku-4-5",
  deepseek: "deepseek-chat",
};

export function loadProviderModels(): Record<string, string> {
  try {
    return { ...DEFAULT_PROVIDER_MODELS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_PROVIDER_MODELS };
  }
}

export function saveProviderModel(providerId: string, modelId: string) {
  const models = loadProviderModels();
  models[providerId] = modelId.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
}
