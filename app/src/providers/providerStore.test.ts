import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/platform", () => ({ isDesktopHost: true }));

import { loadProviderConfigs } from "./providerStore";

describe("loadProviderConfigs", () => {
  beforeEach(() => invoke.mockReset());

  it("loads only user-created custom providers", async () => {
    invoke.mockImplementation(async (command: string, args?: { id?: string }) => {
      if (command === "ai_provider_list") {
        return [
          { id: "openai", name: "OpenAI", kind: "builtin", apiBase: "https://api.openai.com/v1", modelId: "gpt-4o-mini", hasKey: true, originDeviceId: "d1", originLabel: "OFFICE-PC", originPlatform: "windows", keyAvailable: true },
          { id: "deepseek", name: "DeepSeek", kind: "preset", apiBase: "https://api.deepseek.com/v1", modelId: "deepseek-chat", hasKey: true, originDeviceId: "d1", originLabel: "OFFICE-PC", originPlatform: "windows", keyAvailable: true },
          { id: "custom_glm", name: "GLM 5.2", kind: "custom", apiBase: "https://example.test/v1", modelId: "glm-5.2", hasKey: true, originDeviceId: "d1", originLabel: "OFFICE-PC", originPlatform: "windows", keyAvailable: true },
        ];
      }
      if (command === "ai_provider_key") return `key-for-${args?.id}`;
      return null;
    });

    await expect(loadProviderConfigs()).resolves.toEqual({
      custom_glm: {
        id: "custom_glm",
        name: "GLM 5.2",
        kind: "custom",
        apiBase: "https://example.test/v1",
        modelId: "glm-5.2",
        hasKey: true,
        originDeviceId: "d1",
        originLabel: "OFFICE-PC",
        originPlatform: "windows",
        keyAvailable: true,
        apiKey: "key-for-custom_glm",
      },
    });
    expect(invoke).toHaveBeenCalledWith("ai_provider_key", { id: "custom_glm" });
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_key", { id: "openai" });
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_key", { id: "deepseek" });
  });

  it("skips the key round-trip for a key this device cannot decrypt", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "ai_provider_list") {
        return [
          // Added on a machine whose local keychain sealed the key (a copied
          // database): hasKey, but not decryptable here.
          { id: "custom_far", name: "Far key", kind: "custom", apiBase: "https://x.test/v1", modelId: "m", hasKey: true, originDeviceId: "d2", originLabel: "", originPlatform: "macos", keyAvailable: false },
          { id: "custom_near", name: "Near key", kind: "custom", apiBase: "https://y.test/v1", modelId: "m", hasKey: true, originDeviceId: "d1", originLabel: "", originPlatform: "windows", keyAvailable: true },
        ];
      }
      if (command === "ai_provider_key") return "near-key";
      return null;
    });

    const configs = await loadProviderConfigs();
    expect(configs.custom_far).toMatchObject({ hasKey: true, keyAvailable: false, apiKey: "" });
    expect(configs.custom_near).toMatchObject({ hasKey: true, keyAvailable: true, apiKey: "near-key" });
    expect(invoke).toHaveBeenCalledWith("ai_provider_key", { id: "custom_near" });
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_key", { id: "custom_far" });
  });
});
