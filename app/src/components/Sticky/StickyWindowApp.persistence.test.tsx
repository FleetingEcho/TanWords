import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StickyWindowApp } from "./StickyWindowApp";

const { invoke, blocks } = vi.hoisted(() => ({
  invoke: vi.fn(),
  blocks: [{ type: "paragraph", props: {}, content: [{ type: "text", text: "edited", styles: {} }] }],
}));

vi.mock("@/ipc/backend", () => ({
  invoke,
  backendOrigin: async () => "http://127.0.0.1:1",
  backendToken: async () => "test-token",
}));
vi.mock("@/ipc/events", () => ({ subscribe: () => () => {} }));
vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("./StickyToolbar", () => ({ StickyToolbar: () => null }));
vi.mock("@/components/Documents/tiptap/LazyTiptapDocumentEditor", () => ({
  LazyTiptapDocumentEditor: ({ onReady, onChange }: {
    onReady: (api: { document: typeof blocks }) => void;
    onChange: () => void;
  }) => {
    onReady({ document: blocks });
    return <button type="button" onClick={onChange}>edit body</button>;
  },
}));

const note = {
  id: 7, title: "Original", custom_title: false, preview: "old", word_count: 1,
  color: "yellow", corner: "rounded", opacity: 100, always_on_top: true,
  font_family: null, font_size: null, x: 10, y: 20, w: 320, h: 280,
  collapsed: false, is_open: true, content: "[]",
};

describe("desktop sticky persistence", () => {
  let bounds: { x: number; y: number; width: number; height: number };
  beforeEach(() => {
    window.history.replaceState({}, "", "/sticky.html?id=7");
    bounds = { x: 10, y: 20, width: 320, height: 280 };
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args?: { height?: number }) => {
      if (command === "sticky_get") return note;
      if (command === "db_get_setting") return null;
      if (command === "window_get_bounds") return bounds;
      if (command === "stickywin_set_bounds") bounds = { ...bounds, ...args };
      return null;
    });
  });

  it("waits for a final save before closing and stays open on failure", async () => {
    let finishSave!: (value: unknown) => void;
    invoke.mockImplementation((command: string) => {
      if (command === "sticky_get") return Promise.resolve(note);
      if (command === "db_get_setting") return Promise.resolve(null);
      if (command === "window_get_bounds") return Promise.resolve(bounds);
      if (command === "sticky_save_content") return new Promise((resolve) => { finishSave = resolve; });
      return Promise.resolve(null);
    });
    render(<StickyWindowApp />);
    fireEvent.click(await screen.findByText("edit body"));
    fireEvent.click(screen.getByTitle("sticky.close"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sticky_save_content", expect.objectContaining({ id: 7 })));
    expect(invoke).not.toHaveBeenCalledWith("stickywin_close", expect.anything());
    finishSave(null);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stickywin_close", { id: 7 }));
  });

  it("preserves the expanded height while collapsed and restores it", async () => {
    render(<StickyWindowApp />);
    fireEvent.click(await screen.findByTitle("sticky.collapse"));
    await waitFor(() => expect(bounds.height).toBe(44));
    expect(invoke).toHaveBeenCalledWith("sticky_update_window_state", expect.objectContaining({ h: 280, collapsed: true }));
    fireEvent.click(await screen.findByTitle("sticky.expand"));
    await waitFor(() => expect(bounds.height).toBe(280));
    expect(invoke).toHaveBeenCalledWith("sticky_update_window_state", expect.objectContaining({ h: 280, collapsed: false }));
  });
});
