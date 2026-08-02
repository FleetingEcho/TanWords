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
    modelId: string
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
}
