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

// Register built-in providers.
//
// Web semantics: the key arguments are IGNORED (kept in the signature only so
// desktop call-site shapes keep compiling). API keys never enter the browser -
// every request goes to the same-origin `/api/ai-proxy/<providerId>` base and
// the server injects the stored credential upstream. The provider id is the
// one used in the `ai_providers` table ("openai"/"claude"/custom_*).
export function registerBuiltInProviders(_openaiKey: string, _anthropicKey: string, models?: { openai?: string; claude?: string }) {
  providers.set(
    "openai",
    new OpenAIProvider("/api/ai-proxy/openai", "", models?.openai || "gpt-4o-mini")
  );
  providers.set(
    "claude",
    new AnthropicProvider("/api/ai-proxy/claude", "", models?.claude || "claude-haiku-4-5")
  );
  notify();
}

export function registerCustomProvider(
  id: string,
  name: string,
  _apiBase: string,
  _apiKey: string,
  modelId: string
) {
  // See registerBuiltInProviders: base/key are server-side, the browser only
  // ever talks to the proxy path for this provider id.
  providers.set(id, new CustomProvider(id, name, `/api/ai-proxy/${encodeURIComponent(id)}`, "", modelId));
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
