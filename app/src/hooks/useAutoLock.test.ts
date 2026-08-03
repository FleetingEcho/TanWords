import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// settingsStore reads the colour-scheme media query at import time.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

import { useAutoLock } from "./useAutoLock";
import { useAppLockStore } from "@/store/appLockStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";

const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  useAppLockStore.setState({ enabled: true, locked: false });
  useSettingsStore.setState({ autoLockMinutes: 10 });
  usePodcastPlayerStore.setState({ status: "idle" });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Push the clock forward far enough that at least one idle tick runs. */
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

describe("useAutoLock", () => {
  it("locks once the configured idle stretch passes", async () => {
    renderHook(() => useAutoLock());

    await advance(9 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(false);

    await advance(1 * MINUTE + 20_000);
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it("starts the stretch over on input", async () => {
    renderHook(() => useAutoLock());

    await advance(9 * MINUTE);
    act(() => { window.dispatchEvent(new Event("keydown")); });

    // Past the original deadline, but only nine minutes past the keypress.
    await advance(2 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(false);

    await advance(9 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it("never locks while the interval is off", async () => {
    useSettingsStore.setState({ autoLockMinutes: 0 });
    renderHook(() => useAutoLock());

    await advance(3 * 60 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it("never locks without a password set", async () => {
    useAppLockStore.setState({ enabled: false });
    renderHook(() => useAutoLock());

    await advance(60 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it("holds off while a podcast is playing, and locks after it stops", async () => {
    usePodcastPlayerStore.setState({ status: "playing" });
    renderHook(() => useAutoLock());

    await advance(60 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(false);

    usePodcastPlayerStore.setState({ status: "paused" });
    await advance(11 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it("drops its listeners and timer on unmount", async () => {
    const { unmount } = renderHook(() => useAutoLock());
    unmount();

    await advance(60 * MINUTE);
    expect(useAppLockStore.getState().locked).toBe(false);
  });
});
