import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { editorRender, listLocalDocs, readLocalDoc } = vi.hoisted(() => ({
  editorRender: vi.fn(),
  listLocalDocs: vi.fn(),
  readLocalDoc: vi.fn(),
}));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    getSetting: vi.fn().mockResolvedValue("/vault"),
    setSetting: vi.fn(),
  }),
}));

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/localDocs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/localDocs")>();
  return {
    ...actual,
    listLocalDocs,
    readLocalDoc,
    searchLocalDocs: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("./LocalDocsSidebar", () => ({
  LocalDocsSidebar: ({
    search,
    onSearchChange,
    searching,
  }: {
    search: string;
    onSearchChange: (value: string) => void;
    searching: boolean;
  }) => (
    <>
      <input
        aria-label="local-doc-search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <span data-testid="searching">{String(searching)}</span>
    </>
  ),
}));

vi.mock("./LazyLocalDocEditor", () => ({
  LazyLocalDocEditor: () => {
    editorRender();
    return <div>large editor</div>;
  },
}));

vi.mock("@/components/ui/ConfirmModal", () => ({
  ConfirmModal: () => null,
}));

vi.mock("./ExportMarkdownDialog", () => ({
  ExportMarkdownDialog: () => null,
}));

vi.mock("@/ipc/dialog", () => ({
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
}));

vi.mock("@/ipc/backend", () => ({
  invoke: vi.fn(),
  assetUrl: (path: string) => path,
  isAssetUrl: () => false,
  assetUrlToPath: (url: string) => url,
}));

import { LocalDocsView } from "./LocalDocsView";

describe("LocalDocsView editor render isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("tanwords_doc_last_local_path", "large.md");
    listLocalDocs.mockResolvedValue([{
      rel_path: "large.md",
      name: "large.md",
      modified_ms: 1,
      size: 1_000_000,
    }]);
    readLocalDoc.mockResolvedValue("# large\n\ncontent");
  });

  it("does not re-render the mounted editor when local-folder search is cleared", async () => {
    render(<LocalDocsView />);

    await screen.findByText("large editor");
    await waitFor(() => expect(screen.getByTestId("searching")).toHaveTextContent("false"));
    await act(async () => {
      await Promise.resolve();
    });
    editorRender.mockClear();

    fireEvent.change(screen.getByLabelText("local-doc-search"), {
      target: { value: "needle" },
    });
    await waitFor(() => expect(screen.getByTestId("searching")).toHaveTextContent("true"));

    editorRender.mockClear();
    fireEvent.change(screen.getByLabelText("local-doc-search"), {
      target: { value: "" },
    });
    await waitFor(() => expect(screen.getByTestId("searching")).toHaveTextContent("false"));

    expect(editorRender).not.toHaveBeenCalled();
  });

  it("refreshes the local file list when the parent asks for a refresh", async () => {
    const { rerender } = render(<LocalDocsView refreshTick={0} />);
    await screen.findByText("large editor");
    expect(listLocalDocs).toHaveBeenCalledTimes(1);

    rerender(<LocalDocsView refreshTick={1} />);
    await waitFor(() => expect(listLocalDocs).toHaveBeenCalledTimes(2));
  });
});
