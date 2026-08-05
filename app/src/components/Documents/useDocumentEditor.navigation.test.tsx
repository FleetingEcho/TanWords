import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    getDocument,
    updateDocument: vi.fn(),
    createDocument: vi.fn(),
    setDocumentsFolder: vi.fn(),
    unlockDocument: vi.fn(),
    removeDocumentProtection: vi.fn(),
  }),
}));
vi.mock("@/lib/documentAssets", () => ({ pruneDocumentAssets: vi.fn() }));
vi.mock("@/lib/documentRevisions", () => ({ saveDocumentRevision: vi.fn() }));

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
});
