import { describe, it, expect } from "vitest";
import { coverGradient, hashString } from "./cover";

describe("coverGradient", () => {
  it("is deterministic for the same name", () => {
    expect(coverGradient("英语听力")).toEqual(coverGradient("英语听力"));
  });

  it("produces different covers for different names", () => {
    const hues = new Set(["podcasts", "recordings", "music", "英语听力", ""].map((n) => coverGradient(n).css));
    expect(hues.size).toBeGreaterThan(3);
  });

  it("emits a valid two-stop linear gradient", () => {
    const { css, hue } = coverGradient("podcasts");
    expect(css).toMatch(/^linear-gradient\(\d+deg, hsl\(\d+ 65% 62%\), hsl\(\d+ 70% 40%\)\)$/);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("hash is stable (regression pin)", () => {
    expect(hashString("podcasts")).toBe(hashString("podcasts"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});
