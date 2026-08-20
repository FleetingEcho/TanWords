import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The regression this pins: on web the "fetch available models" step of the
// add-provider form used a hardcoded provider id ("custom") that was never a
// saved row, and the request went out as GET /api/ai-proxy/custom/models —
// which the server proxy answered 405 on (POST-only route) and would have
// 404'd on anyway (no such provider). The fix saves the draft under one
// stable id and fetches through the proxy under that same id.
const { invoke, netFetch } = vi.hoisted(() => ({ invoke: vi.fn(), netFetch: vi.fn() }));
// Mutable host flag so one file can cover both web and desktop.
const host = vi.hoisted(() => ({ value: false }));

vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/ipc/net", () => ({ netFetch }));
vi.mock("@/platform", () => ({
  get isDesktopHost() {
    return host.value;
  },
}));
vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProviderSection } from "./ProviderSection";

const MODELS_BODY = JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] });

beforeEach(() => {
  host.value = false;
  invoke.mockReset();
  netFetch.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "ai_provider_list" ? [] : null,
  );
  netFetch.mockResolvedValue(
    new Response(MODELS_BODY, { status: 200, headers: { "Content-Type": "application/json" } }),
  );
});

async function openAddForm() {
  const { container } = render(<ProviderSection />);
  await screen.findByText("settings.addCustomTitle");
  fireEvent.click(screen.getByRole("button", { name: "settings.addCustomTitle" }));
  return container;
}

async function fillForm(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText("e.g., Ollama"), {
    target: { value: "My Ollama" },
  });
  fireEvent.change(screen.getByPlaceholderText("http://localhost:11434/v1"), {
    target: { value: "http://localhost:11434/v1" },
  });
  // The key input is type=password with no placeholder — query it by type.
  const keyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
  fireEvent.change(keyInput, { target: { value: "sk-test" } });
}

function clickFetchModels() {
  fireEvent.click(screen.getByRole("button", { name: "settings.fetchModels" }));
}

describe("ProviderSection add-form model fetch", () => {
  it("web: persists the draft under one id, fetches models through the proxy under that id, and Add finalizes the same row", async () => {
    const container = await openAddForm();
    await fillForm(container);
    clickFetchModels();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai_provider_upsert",
        expect.objectContaining({
          id: expect.stringMatching(/^custom_\d+$/),
          apiBase: "http://localhost:11434/v1",
          apiKey: "sk-test",
        }),
      );
    });

    const upsertCall = invoke.mock.calls.find(([cmd]) => cmd === "ai_provider_upsert");
    const draftId = (upsertCall![1] as { id: string }).id;

    // The proxy URL must reference the SAVED draft id, not a hardcoded "custom".
    expect(netFetch).toHaveBeenCalledWith(`/api/ai-proxy/${draftId}/models`, expect.anything());

    // The first model is auto-selected when none was typed, so Add is enabled.
    fireEvent.click(screen.getByRole("button", { name: "settings.add" }));
    await waitFor(() => {
      const upserts = invoke.mock.calls.filter(([cmd]) => cmd === "ai_provider_upsert");
      expect(upserts.length).toBe(2);
      expect(upserts[1][1]).toMatchObject({
        id: draftId,
        name: "My Ollama",
        apiBase: "http://localhost:11434/v1",
        modelId: "model-a",
        apiKey: "sk-test",
      });
    });

    // The finalized row must never be deleted by the draft cleanup.
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_delete", expect.anything());
  });

  it("web: cancelling after a fetch deletes the persisted draft row", async () => {
    const container = await openAddForm();
    await fillForm(container);
    clickFetchModels();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai_provider_upsert", expect.anything());
    });

    const upsertCall = invoke.mock.calls.find(([cmd]) => cmd === "ai_provider_upsert");
    const draftId = (upsertCall![1] as { id: string }).id;

    fireEvent.click(screen.getByRole("button", { name: "settings.cancel" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai_provider_delete", { id: draftId });
    });
  });

  it("desktop: fetches the typed base URL directly and never writes a draft row first", async () => {
    host.value = true;
    const container = await openAddForm();
    await fillForm(container);
    clickFetchModels();

    // Desktop goes straight at the typed endpoint — no draft row, no proxy.
    await waitFor(() => {
      expect(netFetch).toHaveBeenCalledWith(
        "http://localhost:11434/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
        }),
      );
    });
    expect(invoke).not.toHaveBeenCalledWith("ai_provider_upsert", expect.anything());
  });

  it("web: saving an edit with an empty key field keeps the stored key", async () => {
    host.value = false;
    invoke.mockImplementation(async (command: string) =>
      command === "ai_provider_list"
        ? [
            {
              id: "custom_1",
              name: "My Provider",
              kind: "custom",
              apiBase: "http://localhost:11434/v1",
              modelId: "model-x",
              hasKey: true,
            },
          ]
        : null,
    );
    render(<ProviderSection />);
    await screen.findByRole("button", { name: /My Provider/ });

    // Expand the row and start editing.
    fireEvent.click(screen.getByRole("button", { name: /My Provider/ }));
    fireEvent.click(screen.getByRole("button", { name: "settings.edit" }));

    // Change only the name. On web the key field is empty (the key is never
    // exposed to the browser) — saving must NOT clear the stored key.
    fireEvent.change(screen.getByDisplayValue("My Provider"), {
      target: { value: "My Provider 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai_provider_upsert",
        expect.objectContaining({
          id: "custom_1",
          name: "My Provider 2",
          apiBase: "http://localhost:11434/v1",
          // undefined -> dropped by JSON.stringify -> backend's None -> keep.
          apiKey: undefined,
        }),
      );
    });
  });
});
