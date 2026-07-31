import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (command: string, _args?: unknown) => {
  if (command === "browser_get_state") return { tabs: [], active: null };
  if (command === "browser_show") return "tab-1";
  return null;
});

vi.mock("@/ipc/backend", () => ({ invoke: (c: string, a?: unknown) => invoke(c, a) }));
vi.mock("@/ipc/events", () => ({ subscribeAll: () => () => {} }));

import { useBrowserPanel } from "./useBrowserPanel";

/** Mounts the hook against a laid-out placeholder and exposes its `open`. */
function Harness({ onReady }: { onReady: (open: (raw: string) => Promise<void>) => void }) {
  const { setContainer, open } = useBrowserPanel();
  onReady(open);
  return <div ref={setContainer} />;
}

let open: (raw: string) => Promise<void> = async () => {};

function mount() {
  const utils = render(<Harness onReady={(fn) => { open = fn; }} />);
  return utils;
}

/** `showAt` waits two animation frames before it measures. */
async function settleFrames() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      vi.advanceTimersByTime(16);
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  invoke.mockClear();
  vi.useFakeTimers();
  // jsdom has no rAF loop worth waiting on — drive it off the fake timers.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
  // jsdom ships neither of these; the hook observes the placeholder to keep the
  // native view aligned with it.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 48, width: 800, height: 600, right: 800, bottom: 648, x: 0, y: 48, toJSON: () => ({}) }) as DOMRect;
});

describe("useBrowserPanel", () => {
  it("opens a url", async () => {
    mount();

    await act(async () => { void open("https://example.com"); });
    await settleFrames();

    expect(invoke).toHaveBeenCalledWith("browser_show", expect.objectContaining({ url: "https://example.com" }));
  });

  // StrictMode (which main.tsx enables) runs mount → cleanup → mount again on
  // the *same* fiber, so refs survive the simulated unmount. A "have I
  // unmounted?" guard set in the cleanup but never cleared on mount therefore
  // stays true forever, and the panel silently refuses to show anything —
  // every shortcut and the address bar stop doing anything at all.
  //
  // A real remount is not affected (it gets a fresh ref), which is exactly why
  // this has to be asserted under StrictMode to mean anything.
  it("still opens a url after StrictMode's double effect invocation", async () => {
    render(
      <React.StrictMode>
        <Harness onReady={(fn) => { open = fn; }} />
      </React.StrictMode>,
    );
    invoke.mockClear();

    await act(async () => { void open("https://example.com"); });
    await settleFrames();

    expect(invoke).toHaveBeenCalledWith("browser_show", expect.objectContaining({ url: "https://example.com" }));
  });

  it("hides the panel without capturing a snapshot when the page goes away", async () => {
    const { unmount } = mount();
    invoke.mockClear();

    await act(async () => { unmount(); });

    // Capturing a frame nobody will render only delays the detach the user is
    // waiting on.
    expect(invoke).toHaveBeenCalledWith("browser_hide", { withSnapshot: false });
  });
});
