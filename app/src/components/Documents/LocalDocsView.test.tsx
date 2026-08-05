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
    getDevicePath: vi.fn().mockResolvedValue("/vault"),
    setDevicePath: vi.fn(),
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
    files,
    onOpen,
  }: {
    search: string;
    onSearchChange: (value: string) => void;
    searching: boolean;
    files: Array<{ rel_path: string }>;
    onOpen: (path: string) => void;
  }) => (
    <>
      {files.map((file) => <button key={file.rel_path} onClick={() => onOpen(file.rel_path)}>{file.rel_path}</button>)}
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
  LazyLocalDocEditor: ({ relPath }: { relPath: string }) => {
    editorRender();
    return <div><span>large editor</span><span data-testid="editor-path">{relPath}</span></div>;
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

  it("keeps the latest file click when an earlier large read finishes later", async () => {
    localStorage.removeItem("tanwords_doc_last_local_path");
    listLocalDocs.mockResolvedValue([
      { rel_path: "slow.md", name: "slow.md", modified_ms: 1, size: 1_000_000 },
      { rel_path: "fast.md", name: "fast.md", modified_ms: 2, size: 10 },
    ]);
    let resolveSlow!: (value: string) => void;
    const slow = new Promise<string>((resolve) => { resolveSlow = resolve; });
    readLocalDoc.mockImplementation((_: string, path: string) => path === "slow.md" ? slow : Promise.resolve("# fast"));
    render(<LocalDocsView />);

    fireEvent.click(await screen.findByText("slow.md"));
    fireEvent.click(screen.getByText("fast.md"));
    await screen.findByText("large editor", { exact: false });
    expect(screen.getByTestId("editor-path")).toHaveTextContent("fast.md");
    expect(readLocalDoc).toHaveBeenCalledWith("/vault", "fast.md");

    await act(async () => { resolveSlow("# stale slow"); await slow; });
    expect(screen.getByTestId("editor-path")).toHaveTextContent("fast.md");
    expect(readLocalDoc).toHaveBeenCalledTimes(2);
  });
});
