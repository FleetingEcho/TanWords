import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: {} as Record<string, (payload: any) => void>,
}));

vi.mock("@/ipc/backend", () => ({ invoke: mocks.invoke }));
vi.mock("@/ipc/events", () => ({
  subscribeAll: (handlers: Record<string, (payload: any) => void>) => {
    mocks.handlers = handlers;
    return () => {};
  },
}));
vi.mock("@/ipc/shell", () => ({ openExternal: vi.fn() }));

import { useDshPanelBlockStore } from "@/store/dshPanelBlockStore";
import { DshPage } from "./DshPage";

describe("DshPage failed-start UI", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
    mocks.handlers = {};
    useDshPanelBlockStore.setState({ blockers: 0 });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the error inline after dismissing the modal without starting an auto-reopen loop", async () => {
    const view = render(<DshPage visible={false} />);

    act(() => {
      mocks.handlers["dsh:status"]?.({
        status: "failed",
        kind: "other",
        reason: "dsh exited before it was ready (code=127 signal=null)",
      });
    });
    view.rerender(<DshPage visible />);

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("code=127");
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument();

    await act(async () => {});
    expect(mocks.invoke.mock.calls.some(([method]) => method === "dsh_show")).toBe(false);
  });

  it("shows a system error inline (no port-fix modal) for EMFILE/inotify exhaustion", async () => {
    // EMFILE (too many open files / inotify watcher exhaustion) is a system
    // limit, not a port problem. The port-fix modal would mislead the user
    // into "fixing" a port that isn't the issue, so a `systemError` kind must
    // surface the real error inline with only a Retry button — never open the
    // port-fix modal, never freeze.
    const view = render(<DshPage visible={false} />);
    act(() => {
      mocks.handlers["dsh:status"]?.({
        status: "failed",
        kind: "systemError",
        reason: "EMFILE: too many open files, watch '/home/zteng/.dsh/profiles/web'",
      });
    });
    view.rerender(<DshPage visible />);

    // No port-fix modal: neither the modal's Dismiss nor its Apply & Restart.
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply & Restart" })).not.toBeInTheDocument();
    // The real error is shown verbatim, inline.
    expect(screen.getByRole("alert")).toHaveTextContent("EMFILE: too many open files");
    // Only Retry is offered — changing the port can't fix a system limit.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configure" })).not.toBeInTheDocument();

    await act(async () => {});
    expect(mocks.invoke.mock.calls.some(([method]) => method === "dsh_show")).toBe(false);
  });
});
