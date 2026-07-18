import { describe, it, expect } from "vitest";
import { nextIndexOnEnded, nextIndexOnSkip } from "./queue";

describe("nextIndexOnEnded", () => {
  it("order: advances then stops at the end", () => {
    expect(nextIndexOnEnded(0, 3, "order")).toBe(1);
    expect(nextIndexOnEnded(2, 3, "order")).toBeNull();
  });

  it("loop-one: repeats the same index", () => {
    expect(nextIndexOnEnded(1, 3, "loop-one")).toBe(1);
  });

  it("loop-all: wraps around", () => {
    expect(nextIndexOnEnded(2, 3, "loop-all")).toBe(0);
    expect(nextIndexOnEnded(0, 3, "loop-all")).toBe(1);
  });

  it("shuffle: never repeats the current track when others exist", () => {
    for (const r of [0, 0.4, 0.99]) {
      const next = nextIndexOnEnded(1, 3, "shuffle", () => r);
      expect(next).not.toBe(1);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(3);
    }
    expect(nextIndexOnEnded(0, 1, "shuffle")).toBe(0);
  });

  it("empty playlist stops", () => {
    expect(nextIndexOnEnded(0, 0, "order")).toBeNull();
  });
});

describe("nextIndexOnSkip", () => {
  it("advances with wrap in both directions", () => {
    expect(nextIndexOnSkip(2, 3, "order", 1)).toBe(0);
    expect(nextIndexOnSkip(0, 3, "order", -1)).toBe(2);
  });

  it("loop-one still advances on explicit skip", () => {
    expect(nextIndexOnSkip(1, 3, "loop-one", 1)).toBe(2);
  });

  it("shuffle picks a different track", () => {
    expect(nextIndexOnSkip(0, 2, "shuffle", 1, () => 0)).toBe(1);
  });
});
