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
          { id: "openai", name: "OpenAI", kind: "builtin", apiBase: "https://api.openai.com/v1", modelId: "gpt-4o-mini", hasKey: true },
          { id: "deepseek", name: "DeepSeek", kind: "preset", apiBase: "https://api.deepseek.com/v1", modelId: "deepseek-chat", hasKey: true },
          { id: "custom_glm", name: "GLM 5.2", kind: "custom", apiBase: "https://example.test/v1", modelId: "glm-5.2", hasKey: true },
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
        apiKey: "key-for-custom_glm",
      },
    });
    expect(invoke).toHaveBeenCalledWith("ai_provider_key", { id: "custom_glm" });
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_key", { id: "openai" });
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_key", { id: "deepseek" });
  });
});
