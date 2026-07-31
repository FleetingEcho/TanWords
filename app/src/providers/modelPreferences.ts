/** The model each provider starts on before the user picks one.
 *
 *  The chosen model is no longer a separate localStorage entry — it is the
 *  `model_id` column of that provider's row in `ai_providers`, so it moves
 *  with the rest of its configuration (see `providerStore.ts`). These remain
 *  as the defaults for a provider that has never been configured. */
export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  claude: "claude-haiku-4-5",
  deepseek: "deepseek-chat",
};
