import { AIProvider } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { CustomProvider } from "./custom";

const providers = new Map<string, AIProvider>();

// Register built-in providers
export function registerBuiltInProviders(openaiKey: string, anthropicKey: string) {
  providers.set(
    "openai",
    new OpenAIProvider("https://api.openai.com/v1", openaiKey, "gpt-4o-mini")
  );
  providers.set(
    "claude",
    new AnthropicProvider("https://api.anthropic.com", anthropicKey, "claude-haiku-4-5")
  );
}

export function registerCustomProvider(
  id: string,
  name: string,
  apiBase: string,
  apiKey: string,
  modelId: string
) {
  providers.set(id, new CustomProvider(id, name, apiBase, apiKey, modelId));
}

export function removeProvider(id: string) {
  providers.delete(id);
}

export function getProvider(id: string): AIProvider | undefined {
  return providers.get(id);
}

export function getAllProviders(): AIProvider[] {
  return Array.from(providers.values());
}

export type { AIProvider } from "./base";
