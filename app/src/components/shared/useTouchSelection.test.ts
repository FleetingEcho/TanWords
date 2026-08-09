import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTouchSelection } from "./useTouchSelection";

/** jsdom has neither layout nor touch, so the two things the browser supplies
 *  are stubbed — caret hit-testing (the x coordinate *is* the text offset) and
 *  the touch event shape — leaving the gesture state machine itself real. */
function stubCaret(text: Text) {
  (document as unknown as { caretRangeFromPoint: (x: number, y: number) => Range }).caretRangeFromPoint = (x) => {
    const range = document.createRange();
    range.setStart(text, Math.max(0, Math.min(x, text.length)));
    range.collapse(true);
    return range;
  };
}

function touch(type: string, x: number, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
  });
  document.dispatchEvent(event);
}

const SENTENCE = "The cheapest shared machines were fine.";
let text: Text;

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: coarse)",
    media: query, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  const p = document.createElement("p");
  p.textContent = SENTENCE;
  document.body.appendChild(p);
  text = p.firstChild as Text;
  stubCaret(text);
  // elementFromPoint has no layout to consult in jsdom; the gate only cares
  // that the point isn't inside a control or the toolbar.
  document.elementFromPoint = () => p;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useTouchSelection", () => {
  it("selects the tapped word", () => {
    const { result } = renderHook(() => useTouchSelection(true));
    expect(result.current.active).toBe(true);

    act(() => { touch("touchstart", 6); touch("touchend", 6); });
    expect(result.current.range?.toString()).toBe("cheapest");
  });

  it("takes native selection away from the page while it is active", () => {
    const { unmount } = renderHook(() => useTouchSelection(true));
    expect(document.documentElement.hasAttribute("data-touch-select")).toBe(true);
    unmount();
    expect(document.documentElement.hasAttribute("data-touch-select")).toBe(false);
  });

  it("leaves selection to the browser on a fine pointer", () => {
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useTouchSelection(true));
    expect(result.current.active).toBe(false);
    act(() => { touch("touchstart", 6); touch("touchend", 6); });
    expect(result.current.range).toBeNull();
  });

  it("drops the selection when the same word is tapped again", () => {
    const { result } = renderHook(() => useTouchSelection(true));
    act(() => { touch("touchstart", 6); touch("touchend", 6); });
    act(() => { touch("touchstart", 8); touch("touchend", 8); });
    expect(result.current.range).toBeNull();
  });

  it("grows the selection while a long press drags across the line", () => {
    const { result } = renderHook(() => useTouchSelection(true));
    act(() => { touch("touchstart", 4); vi.advanceTimersByTime(400); });
    expect(result.current.range?.toString()).toBe("cheapest");
    expect(result.current.dragging).toBe(true);

    act(() => { touch("touchmove", 23); });
    expect(result.current.range?.toString()).toBe("cheapest shared machines");

    act(() => { touch("touchend", 23); });
    expect(result.current.dragging).toBe(false);
    expect(result.current.range?.toString()).toBe("cheapest shared machines");
  });

  it("reads a moving finger as a scroll, not a press", () => {
    const { result } = renderHook(() => useTouchSelection(true));
    act(() => {
      touch("touchstart", 4);
      touch("touchmove", 4, 60);
      vi.advanceTimersByTime(400);
      touch("touchend", 4);
    });
    expect(result.current.range).toBeNull();
  });

  it("lets a tap follow a link, but still selects on a long press", () => {
    const link = document.createElement("a");
    link.textContent = SENTENCE;
    document.body.appendChild(link);
    stubCaret(link.firstChild as Text);
    document.elementFromPoint = () => link;
    const { result } = renderHook(() => useTouchSelection(true));

    act(() => { touch("touchstart", 6); touch("touchend", 6); });
    expect(result.current.range).toBeNull();

    act(() => { touch("touchstart", 6); vi.advanceTimersByTime(400); touch("touchend", 6); });
    expect(result.current.range?.toString()).toBe("cheapest");
  });

  it("ignores taps on controls, so the toolbar's own buttons still work", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    document.elementFromPoint = () => button;
    const { result } = renderHook(() => useTouchSelection(true));
    act(() => { touch("touchstart", 6); touch("touchend", 6); });
    expect(result.current.range).toBeNull();
  });
});
