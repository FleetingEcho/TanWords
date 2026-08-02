import { getProvider, getAllProviders } from "@/providers";
import { useSettingsStore } from "@/store/settingsStore";
import type { AIProvider } from "@/providers/base";

/**
 * Pick the provider to use for an AI call: the configured default if it has
 * a key, otherwise the first provider with a key, otherwise null.
 * Single source of truth — this logic was previously copy-pasted in 6 files.
 */
export function findBestProvider(): AIProvider | null {
  const defaultId = useSettingsStore.getState().defaultAiProvider;
  const p = getProvider(defaultId);
  if (p?.apiKey) return p;
  return getAllProviders().find((pr) => pr.apiKey) ?? null;
}
