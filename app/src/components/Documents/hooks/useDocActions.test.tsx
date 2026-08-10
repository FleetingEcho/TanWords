import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/ipc/backend", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useDocActions } from "./useDocActions";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useDocActions document privacy", () => {
  it("flushes the active editor before locking its document", async () => {
    const flush = deferred();
    const beforeLock = vi.fn(() => flush.promise);
    const lockDocument = vi.fn(async () => {});
    const onSelect = vi.fn();
    const load = vi.fn(async () => {});
    const db = { lockDocument } as any;
    const { result } = renderHook(() => useDocActions({
      db,
      activeId: 7,
      onSelect,
      load,
      page: 0,
      beforeLock,
    }));
    const doc = { id: 7, protected: true, unlocked: true } as any;

    let action!: Promise<void>;
    act(() => { action = result.current.handlePrivacyAction(doc); });

    expect(beforeLock).toHaveBeenCalledWith(7);
    expect(lockDocument).not.toHaveBeenCalled();

    await act(async () => { flush.resolve(); await action; });
    expect(lockDocument).toHaveBeenCalledWith(7);
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("renames without loading or rewriting document content", async () => {
    const updateDocumentMetadata = vi.fn(async () => true);
    const getDocument = vi.fn();
    const load = vi.fn(async () => {});
    const { result } = renderHook(() => useDocActions({
      db: { updateDocumentMetadata, getDocument } as any,
      activeId: 7,
      onSelect: vi.fn(),
      load,
      page: 0,
    }));

    await act(async () => { await result.current.handleRename(7, "New title"); });

    expect(updateDocumentMetadata).toHaveBeenCalledWith(7, { title: "New title" });
    expect(getDocument).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});
