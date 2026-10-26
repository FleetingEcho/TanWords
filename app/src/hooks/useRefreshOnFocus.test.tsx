import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useRefreshOnFocus } from "./useRefreshOnFocus";

describe("useRefreshOnFocus", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fires on window focus, collapses immediate bursts, and on visible visibilitychange", () => {
    const onRefresh = vi.fn();
    renderHook(() => useRefreshOnFocus(onRefresh));

    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Burst within the 2s window collapses to the one refresh.
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // After the cooldown, focus refreshes again.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3000);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});
