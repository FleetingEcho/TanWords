import { AIProvider } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { CustomProvider } from "./custom";

const providers = new Map<string, AIProvider>();

/** Mutations to this Map are invisible to React on their own, so anything
 * rendering provider state (the top bar's AI indicator) used to poll for it.
 * Bump a version and notify instead — see `useProviderStatus`. */
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getProvidersVersion(): number {
  return version;
}

/** False until `initProviders()` has finished reading keys out of the OS
 * keychain. The Map is empty in the meantime, which is indistinguishable from
 * "no keys configured" — callers that would report the latter to the user
 * should check this first rather than accusing a configured app of being
 * unconfigured for as long as the keychain takes to answer. */
let ready = false;

export function markProvidersReady() {
  if (ready) return;
  ready = true;
  notify();
}

export function areProvidersReady(): boolean {
  return ready;
}

// Register built-in providers
export function registerBuiltInProviders(openaiKey: string, anthropicKey: string, models?: { openai?: string; claude?: string }) {
  providers.set(
    "openai",
    new OpenAIProvider("https://api.openai.com/v1", openaiKey, models?.openai || "gpt-4o-mini")
  );
  providers.set(
    "claude",
    new AnthropicProvider("https://api.anthropic.com", anthropicKey, models?.claude || "claude-haiku-4-5")
  );
  notify();
}

export function registerCustomProvider(
  id: string,
  name: string,
  apiBase: string,
  apiKey: string,
  modelId: string
) {
  providers.set(id, new CustomProvider(id, name, apiBase, apiKey, modelId));
  notify();
}

export function removeProvider(id: string) {
  if (providers.delete(id)) notify();
}

export function getProvider(id: string): AIProvider | undefined {
  return providers.get(id);
}

export function getAllProviders(): AIProvider[] {
  return Array.from(providers.values());
}

export type { AIProvider } from "./base";
