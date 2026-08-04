import { beforeEach, describe, expect, it, vi } from "vitest";

// Force the desktop registration path: it keeps apiKey on the instance, which
// the credential rules below exist to exercise. (jsdom has no preload, so
// platform detection would otherwise take the keyless web branch and every
// registration would arrive without a key.)
vi.mock("@/platform", () => ({ isDesktopHost: true }));

// settingsStore wires a system-theme listener at module scope and jsdom has
// no matchMedia — same polyfill RecommendedModelsList.test.tsx installs.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

import { AnthropicProvider } from "./anthropic";
import { CustomProvider } from "./custom";
import { OpenAIProvider } from "./openai";
import {
  getAllProviders,
  getProvider,
  registerBuiltInProviders,
  registerCustomProvider,
  removeProvider,
} from "./index";
import { findBestProvider } from "./select";
import { useSettingsStore } from "@/store/settingsStore";

function resetRegistry() {
  for (const provider of getAllProviders()) removeProvider(provider.id);
  useSettingsStore.setState({ defaultAiProvider: "openai" });
}

describe("provider credential semantics", () => {
  it("cloud providers need a key", () => {
    expect(new OpenAIProvider("", "", "gpt-4o-mini").hasCredentials).toBe(false);
    expect(new OpenAIProvider("", "sk-x", "gpt-4o-mini").hasCredentials).toBe(true);
    expect(new AnthropicProvider("", "", "claude-haiku-4-5").hasCredentials).toBe(false);
    expect(new AnthropicProvider("", "sk-ant-x", "claude-haiku-4-5").hasCredentials).toBe(true);
  });

  it("self-hosted customs are usable keyless; presets are not", () => {
    expect(new CustomProvider("c1", "Ollama", "http://localhost:11434/v1", "", "llama3", false).hasCredentials).toBe(true);
    expect(new CustomProvider("c1", "DeepSeek", "https://api.deepseek.com/v1", "", "deepseek-chat", true).hasCredentials).toBe(false);
    expect(new CustomProvider("c1", "DeepSeek", "https://api.deepseek.com/v1", "sk-x", "deepseek-chat", true).hasCredentials).toBe(true);
  });

  it("CustomProvider strips pasted endpoint paths, keyless included", () => {
    const p = new CustomProvider("c1", "Ollama", "http://localhost:11434/v1/chat/completions/", "", "llama3", false);
    expect(p.apiBase).toBe("http://localhost:11434/v1");
    expect(p.hasCredentials).toBe(true);
  });
});

describe("findBestProvider", () => {
  beforeEach(resetRegistry);

  it("returns null when nothing can answer", () => {
    registerBuiltInProviders("", "");
    expect(findBestProvider()).toBeNull();
  });

  it("prefers the configured default when it has credentials", () => {
    registerBuiltInProviders("sk-openai", "sk-ant");
    useSettingsStore.setState({ defaultAiProvider: "claude" });
    expect(findBestProvider()?.id).toBe("claude");
  });

  it("regression: a freshly added keyless provider is usable everywhere immediately", () => {
    registerBuiltInProviders("", "");
    registerCustomProvider("custom_1", "Ollama", "http://localhost:11434/v1", "", "llama3", false);
    // Every gate used to require .apiKey outright, so this returned null —
    // the provider existed in Settings but was silently disabled app-wide.
    expect(findBestProvider()?.id).toBe("custom_1");
  });

  it("honours a keyless provider explicitly chosen as default", () => {
    registerBuiltInProviders("sk-openai", "");
    registerCustomProvider("custom_1", "Ollama", "http://localhost:11434/v1", "", "llama3", false);
    useSettingsStore.setState({ defaultAiProvider: "custom_1" });
    expect(findBestProvider()?.id).toBe("custom_1");
  });

  it("skips an unkeyed default and falls back to one that can answer", () => {
    registerBuiltInProviders("", "sk-ant");
    // default left at "openai", which is registered but keyless.
    expect(findBestProvider()?.id).toBe("claude");
  });

  it("does not let a keyless preset pose as configured", () => {
    registerCustomProvider("deepseek", "DeepSeek", "https://api.deepseek.com", "", "deepseek-chat", true);
    expect(getProvider("deepseek")?.hasCredentials).toBe(false);
    expect(findBestProvider()).toBeNull();
  });
});
