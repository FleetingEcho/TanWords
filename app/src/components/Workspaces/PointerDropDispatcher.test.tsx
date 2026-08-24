import { describe, expect, it } from "vitest";
import { zoneAtPoint } from "./PointerDropDispatcher";

const rect = (l: number, t: number, w: number, h: number): DOMRect =>
  ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => "" } as DOMRect);

describe("zoneAtPoint", () => {
  const r = rect(0, 0, 100, 100);

  it("returns null for a point outside the rect", () => {
    expect(zoneAtPoint(r, -1, 50, true)).toBeNull();
    expect(zoneAtPoint(r, 101, 50, true)).toBeNull();
    expect(zoneAtPoint(r, 50, -1, true)).toBeNull();
    expect(zoneAtPoint(r, 50, 101, true)).toBeNull();
  });

  it("returns center for the middle band of an occupied pane", () => {
    expect(zoneAtPoint(r, 50, 50, true)).toBe("center");
    expect(zoneAtPoint(r, 30, 30, true)).toBe("center");
    expect(zoneAtPoint(r, 70, 70, true)).toBe("center");
  });

  it("maps the four edge bands for an occupied pane", () => {
    expect(zoneAtPoint(r, 10, 50, true)).toBe("left");
    expect(zoneAtPoint(r, 90, 50, true)).toBe("right");
    expect(zoneAtPoint(r, 50, 10, true)).toBe("top");
    expect(zoneAtPoint(r, 50, 90, true)).toBe("bottom");
  });

  it("an empty pane only offers center, even at the edges", () => {
    expect(zoneAtPoint(r, 10, 50, false)).toBe("center");
    expect(zoneAtPoint(r, 90, 50, false)).toBe("center");
    expect(zoneAtPoint(r, 50, 10, false)).toBe("center");
    expect(zoneAtPoint(r, 50, 50, false)).toBe("center");
  });
});
