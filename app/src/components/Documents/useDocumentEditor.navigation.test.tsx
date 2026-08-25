import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDocument, updateDocumentContent, updateDocumentMetadata, toastError } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  updateDocumentContent: vi.fn(async () => true),
  updateDocumentMetadata: vi.fn(async () => true),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    getDocument,
    updateDocumentContent,
    updateDocumentMetadata,
    createDocument: vi.fn(),
    setDocumentsFolder: vi.fn(),
    unlockDocument: vi.fn(),
    removeDocumentProtection: vi.fn(),
  }),
}));
vi.mock("@/lib/documentAssets", () => ({ pruneDocumentAssets: vi.fn() }));
vi.mock("@/lib/documentRevisions", () => ({ saveDocumentRevision: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { useDocumentEditor } from "./useDocumentEditor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const detail = (id: number) => ({
  id,
  title: `doc ${id}`,
  content: "[]",
  content_text: "",
  tags: "[]",
  pinned: false,
  word_count: 0,
  created_at: "",
  updated_at: "",
});

describe("useDocumentEditor latest-click navigation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unmounts the old document immediately and ignores a slower stale read", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    getDocument.mockImplementation((id: number) => id === 1 ? first.promise : second.promise);
    const { result } = renderHook(() => useDocumentEditor());

    let firstLoad!: Promise<void>;
    act(() => { firstLoad = result.current.loadDoc(1); });
    expect(result.current.activeId).toBe(1);
    expect(result.current.doc).toBeNull();
    expect(result.current.loading).toBe(true);

    let secondLoad!: Promise<void>;
    act(() => { secondLoad = result.current.loadDoc(2); });
    expect(result.current.activeId).toBe(2);
    expect(result.current.doc).toBeNull();

    await act(async () => { first.resolve(detail(1)); await firstLoad; });
    expect(result.current.activeId).toBe(2);
    expect(result.current.doc).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { second.resolve(detail(2)); await secondLoad; });
    expect(result.current.doc?.id).toBe(2);
    expect(result.current.loading).toBe(false);
  });

  it("keeps metadata and content writes on separate persistence paths", async () => {
    getDocument.mockResolvedValue(detail(1));
    const { result } = renderHook(() => useDocumentEditor());
    await act(async () => { await result.current.loadDoc(1); });

    await act(async () => { await result.current.handleTitleChange("Renamed"); });
    expect(updateDocumentMetadata).toHaveBeenCalledWith(1, { title: "Renamed" });
    expect(updateDocumentContent).not.toHaveBeenCalled();

    await act(async () => { await result.current.handleSave("new-content", "new text", 2); });
    expect(updateDocumentContent).toHaveBeenCalledWith(1, "new-content", "new text", 2);
  });

  it("corrects a legacy whitespace-only Chinese count when opening a document", async () => {
    getDocument.mockResolvedValue({
      ...detail(1),
      content_text: "你好 world",
      word_count: 2,
    });
    const { result } = renderHook(() => useDocumentEditor());

    await act(async () => { await result.current.loadDoc(1); });

    expect(result.current.doc?.word_count).toBe(3);
  });

  it("keeps a failed save dirty so it can be retried", async () => {
    getDocument.mockResolvedValue(detail(1));
    updateDocumentContent.mockRejectedValueOnce(new Error("Turso database write timed out"));
    const { result } = renderHook(() => useDocumentEditor());
    await act(async () => { await result.current.loadDoc(1); });

    await act(async () => {
      await expect(result.current.handleSave("unsaved-content", "unsaved text", 2))
        .rejects.toThrow("Turso database write timed out");
    });

    expect(result.current.saveStatus).toBe("dirty");
    expect(toastError).toHaveBeenCalledWith("Save failed");
  });

  it("waits for an attachment upload and flushes its document before navigating", async () => {
    getDocument.mockImplementation(async (id: number) => detail(id));
    const upload = deferred<void>();
    const flush = vi.fn(async () => {});
    const { result } = renderHook(() => useDocumentEditor());
    await act(async () => { await result.current.loadDoc(1); });
    act(() => {
      result.current.registerActiveFlush(flush);
      result.current.registerActiveUpload(upload.promise);
    });

    let navigation!: Promise<void>;
    act(() => { navigation = result.current.loadDoc(2); });
    expect(result.current.activeId).toBe(1);
    expect(result.current.doc?.id).toBe(1);
    expect(getDocument).not.toHaveBeenCalledWith(2);

    await act(async () => {
      upload.resolve();
      await navigation;
    });

    expect(flush).toHaveBeenCalledOnce();
    expect(getDocument).toHaveBeenCalledWith(2);
    expect(result.current.doc?.id).toBe(2);
  });
});
