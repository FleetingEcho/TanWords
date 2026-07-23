export interface ProviderDef {
  id: string;
  name: string;
  model: string;
  dot: string;
  isCustom?: boolean;
  apiBase?: string;
}

export const BUILT_IN_PROVIDERS: ProviderDef[] = [
  { id: "openai", name: "OpenAI", model: "gpt-4o-mini", dot: "#22c55e" },
  { id: "claude", name: "Claude", model: "haiku-4.5", dot: "#8b5cf6" },
];

export const PRESET_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", model: "deepseek-chat", dot: "#3b82f6", apiBase: "https://api.deepseek.com/v1" },
];

export function loadCustomProvidersMeta(): { id: string; name: string; apiBase: string; modelId: string }[] {
  try { return JSON.parse(localStorage.getItem("tanwords_custom_providers") || "[]"); } catch { return []; }
}

export function saveCustomProvidersMeta(providers: { id: string; name: string; apiBase: string; modelId: string }[]) {
  localStorage.setItem("tanwords_custom_providers", JSON.stringify(providers));
}
