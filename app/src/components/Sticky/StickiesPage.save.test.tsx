import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StickiesPage } from "./StickiesPage";

const { invoke, blocks } = vi.hoisted(() => ({
  invoke: vi.fn(),
  blocks: [{ type: "paragraph", props: {}, content: [{ type: "text", text: "edited", styles: {} }] }],
}));

vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/store/settingsStore", () => {
  const state = { theme: "light", loadFromDB: async () => {} };
  const useSettingsStore = Object.assign((select: (value: { theme: string; loadFromDB: () => Promise<void> }) => unknown) => select(state), { getState: () => state });
  return { useSettingsStore };
});
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
  id: 1, title: "Note", preview: "old", word_count: 1, content: "[]",
  color: "yellow", updated_at: "2026-10-29 12:00:00",
};

describe("web sticky editor save", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "sticky_list") return [note];
      if (command === "sticky_get") return note;
      return null;
    });
  });

  it("waits for the latest edit before closing the drawer", async () => {
    let finishSave!: () => void;
    invoke.mockImplementation((command: string) => {
      if (command === "sticky_list") return Promise.resolve([note]);
      if (command === "sticky_get") return Promise.resolve(note);
      if (command === "sticky_save_content") return new Promise<void>((resolve) => { finishSave = resolve; });
      return Promise.resolve(null);
    });

    render(<StickiesPage />);
    fireEvent.click(await screen.findByText("Note"));
    fireEvent.click(await screen.findByText("edit body"));
    fireEvent.click(screen.getByTitle("sticky.close"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sticky_save_content", expect.objectContaining({ id: 1 })));
    expect(screen.getByText("edit body")).toBeInTheDocument();
    finishSave();
    await waitFor(() => expect(screen.queryByText("edit body")).toBeNull());
  });

  it("keeps the drawer open and offers retry if the final save fails", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "sticky_list") return Promise.resolve([note]);
      if (command === "sticky_get") return Promise.resolve(note);
      if (command === "sticky_save_content") return Promise.reject("offline");
      return Promise.resolve(null);
    });

    render(<StickiesPage />);
    fireEvent.click(await screen.findByText("Note"));
    fireEvent.click(await screen.findByText("edit body"));
    fireEvent.click(screen.getByTitle("sticky.close"));

    expect(await screen.findByText("sticky.retrySave")).toBeInTheDocument();
    expect(screen.getByText("edit body")).toBeInTheDocument();
  });
});
