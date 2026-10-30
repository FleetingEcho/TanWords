import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateButton } from "./UpdateButton";
import { useUpdaterStore } from "@/store/updaterStore";

vi.mock("@/ipc/app", () => ({
  getVersion: async () => "2.5.0",
  relaunch: vi.fn(),
}));
vi.mock("@/ipc/shell", () => ({ openExternal: vi.fn() }));

describe("UpdateButton release notes", () => {
  beforeEach(() => {
    useUpdaterStore.setState({
      status: "available",
      version: "2.6.0",
      notes: "<div><h1>Highlights</h1><div>Fixed &amp; improved<div><script>alert('bad')</script>",
      progress: 0,
      error: null,
    });
  });

  it("shows HTML release notes as safe readable text instead of literal tags", async () => {
    render(<UpdateButton />);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Highlights", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Fixed & improved", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/<div>|<h1>|<script>/)).not.toBeInTheDocument();
    expect(screen.queryByText(/alert\('bad'\)/)).not.toBeInTheDocument();
  });
});
