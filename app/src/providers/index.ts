import { create } from "zustand";
import { AIProvider } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { CustomProvider } from "./custom";

const providers = new Map<string, AIProvider>();

/** Bumped on every registry mutation so `useProviders()`/`useHasAnyProviderKey()`
 * subscribers re-render — the Map itself isn't React state, this is what makes
 * "set a key in Settings" visible to already-mounted components elsewhere. */
const useRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
function bump() {
  useRegistryVersion.setState((s) => ({ version: s.version + 1 }));
}

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
  bump();
}

export function registerCustomProvider(
  id: string,
  name: string,
  apiBase: string,
  apiKey: string,
  modelId: string
) {
  providers.set(id, new CustomProvider(id, name, apiBase, apiKey, modelId));
  bump();
}

export function removeProvider(id: string) {
  providers.delete(id);
  bump();
}

export function getProvider(id: string): AIProvider | undefined {
  return providers.get(id);
}

export function getAllProviders(): AIProvider[] {
  return Array.from(providers.values());
}

export function updateProviderApiKey(id: string, apiKey: string) {
  const provider = providers.get(id);
  if (provider) {
    provider.apiKey = apiKey;
    bump();
  }
}

/** Reactive: re-renders the calling component whenever the provider registry
 * changes (a key is set/cleared in Settings, a custom provider is added/removed) —
 * for anything that wants to reflect provider state while mounted, not just
 * read it once imperatively (see providers/select.ts findBestProvider for the
 * imperative, per-action variant most features use today). */
export function useProviders(): AIProvider[] {
  useRegistryVersion((s) => s.version);
  return getAllProviders();
}

export function useHasAnyProviderKey(): boolean {
  useRegistryVersion((s) => s.version);
  return getAllProviders().some((p) => p.apiKey);
}

export type { AIProvider } from "./base";
