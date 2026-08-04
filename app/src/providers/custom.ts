import { OpenAIProvider } from "./openai";

/**
 * Custom provider wraps OpenAIProvider with user-defined configuration.
 * Works with any OpenAI-compatible API (DeepSeek, Ollama, Gemini, etc.)
 */
export class CustomProvider extends OpenAIProvider {
  isCustom = true;

  constructor(
    public id: string,
    public name: string,
    apiBase: string,
    apiKey: string,
    modelId: string,
    /**
     * Preset providers (DeepSeek, Qwen…) are hosted APIs and are useless
     * without a key. A user-added custom provider is usually a self-hosted
     * OpenAI-compatible server (Ollama, LM Studio) that takes keyless
     * requests, so it counts as configured the moment it is registered.
     */
    private readonly requiresKey = true,
  ) {
    // Strip trailing endpoint paths so users can paste full URLs by mistake
    const normalizedBase = apiBase
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/completions\/?$/, "")
      .replace(/\/$/, "");
    super(normalizedBase, apiKey, modelId);
    this.id = id;
    this.name = name;
  }

  get hasCredentials(): boolean {
    return this.requiresKey ? Boolean(this.apiKey) : true;
  }
}
