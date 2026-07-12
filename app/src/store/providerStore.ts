import { create } from "zustand";

export interface CustomProviderConfig {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  isActive: boolean;
  createdAt: string;
}

interface ProviderState {
  customProviders: CustomProviderConfig[];
  activeProviderId: string;

  setCustomProviders: (providers: CustomProviderConfig[]) => void;
  setActiveProviderId: (id: string) => void;
}

export const useProviderStore = create<ProviderState>((set) => ({
  customProviders: [],
  activeProviderId: "openai",

  setCustomProviders: (providers) => set({ customProviders: providers }),
  setActiveProviderId: (id) => set({ activeProviderId: id }),
}));
