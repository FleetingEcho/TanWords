import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/hooks/useT", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) =>
  vars && "device" in vars ? `${key}:${vars.device}` : key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { DevicesSection } from "./DevicesSection";

const DEVICES = [
  { deviceId: "dev-1", label: "OFFICE-PC", platform: "windows", isCurrent: true, createdAt: "2025-01-01 00:00:00", lastSeenAt: "2025-01-02 00:00:00" },
  { deviceId: "dev-2", label: "", platform: "macos", isCurrent: false, createdAt: "2025-01-01 00:00:00", lastSeenAt: "2025-01-02 00:00:00" },
];

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "device_list" ? DEVICES.map((d) => ({ ...d })) : null,
  );
});

describe("DevicesSection", () => {
  it("lists every device, marks this one, and falls back to the platform name for an unnamed row", async () => {
    render(<DevicesSection />);
    await screen.findByText("OFFICE-PC");
    expect(screen.getByText("settings.thisDevice")).toBeTruthy();
    // The unnamed macOS machine shows its platform as the name.
    expect(screen.getByText(/macOS/)).toBeTruthy();
  });

  it("renames any device through device_rename and reloads", async () => {
    render(<DevicesSection />);
    await screen.findByText("OFFICE-PC");

    // Rename the OTHER machine from here — labels live in the shared
    // database, so naming your other machines is the point.
    const macRow = screen.getByText(/macOS/).closest("div[class*='items-center']") as HTMLElement;
    fireEvent.click(macRow.querySelector("button[title='settings.renameDevice']")!);
    const input = screen.getByLabelText("settings.renameDevice") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("device_rename", { deviceId: "dev-2", label: "My laptop" });
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(3); // list, rename, reload
    });
  });
});
