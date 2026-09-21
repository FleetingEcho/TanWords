import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StickyWindowApp } from "./StickyWindowApp";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/ipc/backend", () => ({
  backendOrigin: "http://127.0.0.1:1",
  backendToken: "test-token",
  invoke,
}));
vi.mock("@/ipc/events", () => ({ subscribe: () => () => {} }));
vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/Documents/tiptap/LazyTiptapDocumentEditor", () => ({
  LazyTiptapDocumentEditor: () => <div data-testid="editor" />,
}));

const sticky = {
  id: 7,
  title: "Original title",
  custom_title: true,
  preview: "Body",
  word_count: 1,
  color: "yellow",
  corner: "rounded",
  opacity: 100,
  always_on_top: true,
  font_family: null,
  font_size: null,
  x: 10,
  y: 20,
  w: 320,
  h: 280,
  collapsed: false,
  is_open: true,
  created_at: "2026-09-21T00:00:00",
  updated_at: "2026-09-21T00:00:00",
  content: "[]",
};

describe("StickyWindowApp title editing", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/sticky.html?id=7");
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "sticky_get") return sticky;
      if (command === "db_get_setting") return null;
      if (command === "window_get_bounds") return { x: 10, y: 20, width: 320, height: 280 };
      return null;
    });
  });

  it("keeps the editable title outside the Electron drag region and saves a rename", async () => {
    render(<StickyWindowApp />);
    const title = await screen.findByTitle("Original title");

    expect(title).toHaveClass("app-region-no-drag");

    fireEvent.doubleClick(title);
    const input = screen.getByPlaceholderText("sticky.renameTitle");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("sticky_set_title", {
        id: 7,
        title: "Renamed title",
      });
    });
  });
});
