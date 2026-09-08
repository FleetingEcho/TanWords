import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYBOARD_GAP_THRESHOLD, useMobileVisualViewport } from "./useMobileVisualViewport";

type VVListener = (e?: Event) => void;

/** jsdom has no visualViewport; install a controllable fake whose `resize`
 *  events the hook can observe, like a phone rotating or a keyboard opening. */
function installFakeViewport(initial: { height: number; offsetTop: number }) {
  const listeners = new Set<VVListener>();
  const vv = {
    height: initial.height,
    offsetTop: initial.offsetTop,
    addEventListener: (_: string, fn: VVListener) => listeners.add(fn),
    removeEventListener: (_: string, fn: VVListener) => listeners.delete(fn),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  const resize = () => listeners.forEach((fn) => fn());
  const matchMedia = (q: string) => ({
    matches: q.includes("max-width: 767px"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  });
  vi.stubGlobal("matchMedia", matchMedia);
  (window as any).matchMedia = matchMedia;
  return {
    resize,
    set(height: number, offsetTop = 0) {
      vv.height = height;
      vv.offsetTop = offsetTop;
      resize();
    },
  };
}

describe("useMobileVisualViewport", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  it("reports the visual viewport height on a narrow screen", () => {
    const fake = installFakeViewport({ height: 800, offsetTop: 0 });
    const { result } = renderHook(() => useMobileVisualViewport());
    expect(result.current.height).toBe(800);
    expect(result.current.keyboardOpen).toBe(false);
    act(() => fake.set(740));
    expect(result.current.height).toBe(740);
  });

  it("flags the keyboard open once the visible band shrinks past the threshold", () => {
    const fake = installFakeViewport({ height: 800, offsetTop: 0 });
    const { result } = renderHook(() => useMobileVisualViewport());
    // A gap just under the threshold (address-bar hides never open this much).
    act(() => fake.set(800 - KEYBOARD_GAP_THRESHOLD + 10));
    expect(result.current.keyboardOpen).toBe(false);
    // Keyboard-sized gap.
    act(() => fake.set(500));
    expect(result.current.keyboardOpen).toBe(true);
  });

  it("keeps the keyboard flag stable while the user pans (offsetTop wanders, height stays shrunk)", () => {
    const fake = installFakeViewport({ height: 800, offsetTop: 0 });
    const { result } = renderHook(() => useMobileVisualViewport());
    act(() => fake.set(500));
    expect(result.current.keyboardOpen).toBe(true);
    // Panning while typing: the visual viewport slides down, its height does
    // not change — the keyboard is still open.
    act(() => fake.set(500, 150));
    expect(result.current.keyboardOpen).toBe(true);
    expect(result.current.offsetTop).toBe(150);
  });

  it("reports null above the lg breakpoint so desktop keeps h-full", () => {
    const listeners = new Set<VVListener>();
    const vv = {
      height: 900,
      offsetTop: 0,
      addEventListener: (_: string, fn: VVListener) => listeners.add(fn),
      removeEventListener: (_: string, fn: VVListener) => listeners.delete(fn),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    const wide = (q: string) => ({
      matches: !q.includes("max-width: 767px"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    });
    vi.stubGlobal("matchMedia", wide);
    (window as any).matchMedia = wide;
    const { result } = renderHook(() => useMobileVisualViewport());
    expect(result.current.height).toBeNull();
    expect(result.current.keyboardOpen).toBe(false);
    void listeners;
    void act;
  });
});
