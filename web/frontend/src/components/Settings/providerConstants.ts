export interface ProviderDef {
  id: string;
  name: string;
  model: string;
  dot: string;
  isCustom?: boolean;
  apiBase?: string;
}

/** Built-ins don't let you edit the base URL, so it lives in code rather than
 *  being user data — but each stored row still records it, so anything reading
 *  a provider out of the database has everything it needs to make a call. */
export const BUILT_IN_API_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com",
};

export const BUILT_IN_PROVIDERS: ProviderDef[] = [
  { id: "openai", name: "OpenAI", model: "gpt-4o-mini", dot: "#22c55e" },
  { id: "claude", name: "Claude", model: "haiku-4.5", dot: "#8b5cf6" },
];

export const PRESET_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", model: "deepseek-chat", dot: "#3b82f6", apiBase: "https://api.deepseek.com/v1" },
];
