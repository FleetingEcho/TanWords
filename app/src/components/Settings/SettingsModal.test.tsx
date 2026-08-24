import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useNavStore } from "@/store/navStore";
import { SettingsModal } from "./SettingsModal";

vi.mock("./SettingsPage", () => ({
  SettingsPage: () => <div>Settings content</div>,
}));

beforeEach(() => {
  useNavStore.setState({ settingsOpen: true, settingsSection: undefined });
});

describe("SettingsModal", () => {
  it("renders Settings in a Radix dialog and closes from its explicit button", () => {
    render(<SettingsModal />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Settings content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useNavStore.getState().settingsOpen).toBe(false);
  });
});
