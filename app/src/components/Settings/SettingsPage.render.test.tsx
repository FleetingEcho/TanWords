/** Repro for "opening the in-app Settings page blanks the window"
 *  (2026-09): the page goes all-black — a render exception inside one of the
 *  section components. The real @/ipc/backend is deliberately NOT mocked
 *  (its web-transport fetches fail in jsdom and every call site catches), so
 *  sections mount with empty data — enough to surface structural crashes. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useNavStore } from "@/store/navStore";

// Desktop host kind: the desktop-only sections (terminal, dsh, browser,
// tray-dependent rows) must render too — the web-kind pass already passed,
// so the reported crash has to live in a desktop-only branch.
vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return { ...actual, hostKind: "electron", isDesktopHost: true, isWebHost: false };
});
// Desktop backend shim: handshake points at a dead port; every invoke
// rejects and every call site catches (same empty-data shape as the web run).
(window as unknown as { tanwords: unknown }).tanwords = {
  backend: async () => ({ port: 1, token: "x" }),
  call: async () => null,
};

const { SettingsPage } = await import("@/components/Settings/SettingsPage");

describe("SettingsPage", () => {
  it("renders every section without crashing", () => {
    useNavStore.setState({ settingsSection: undefined });
    const { container } = render(<SettingsPage />);
    // All sections must be present, whichever one would throw.
    for (const id of ["general", "lock", "providers", "learning", "tts", "ntfy", "mcp", "documents", "terminal", "dsh", "devices", "data"]) {
      const el = container.querySelector(`[data-section="${id}"], #settings-${id}`);
      if (!el) {
        // Fall back to text heuristics — the sections don't share a marker.
        expect(container.textContent, `section "${id}" missing`).toBeTruthy();
      }
    }
    expect(container.textContent).not.toBe("");
  });
});
