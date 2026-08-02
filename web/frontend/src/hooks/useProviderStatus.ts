import { useMemo, useSyncExternalStore } from "react";
import {
  areProvidersReady, getAllProviders, getProvidersVersion, subscribeProviders, type AIProvider,
} from "@/providers";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";

export type ProviderStatus = {
  /** False while `initProviders()` is still reading the OS keychain. Nothing
   * is registered yet at that point, so `connected: false` means "don't know",
   * not "no key" — render a neutral state instead of a warning. */
  ready: boolean;
  /** An AI call made right now would find a provider with a key. */
  connected: boolean;
  /** Every registered provider that has a key, for model pickers. */
  available: AIProvider[];
};

/**
 * Live view of the AI provider registry. Re-renders when providers are
 * registered or removed (startup init, saving a key in Settings) instead of
 * making callers poll on a timer.
 */
export function useProviderStatus(): ProviderStatus {
  const version = useSyncExternalStore(subscribeProviders, getProvidersVersion);
  // findBestProvider() consults the configured default, so a default switch
  // has to re-run this too.
  const defaultProvider = useSettingsStore((state) => state.defaultAiProvider);

  return useMemo(() => ({
    ready: areProvidersReady(),
    connected: Boolean(findBestProvider()),
    available: getAllProviders().filter((provider) => provider.apiKey),
  }), [version, defaultProvider]);
}
