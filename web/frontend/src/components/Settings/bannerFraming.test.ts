import { describe, expect, it } from "vitest";
import { coverOverflow, dragToPosition } from "./bannerFraming";

const FRAME = { w: 600, h: 100 }; // 6:1, the banner's shape

describe("coverOverflow", () => {
  it("reports the hidden height for an image taller than the frame", () => {
    // 600x400 scaled to cover a 600x100 frame stays 600 wide, 400 tall: 300px hidden.
    expect(coverOverflow(FRAME, { w: 600, h: 400 })).toEqual({ x: 0, y: 300 });
  });

  it("reports the hidden width for an image wider than the frame", () => {
    // 1200x100 scaled to cover is 1200x100: 600px hidden horizontally.
    expect(coverOverflow(FRAME, { w: 1200, h: 100 })).toEqual({ x: 600, y: 0 });
  });

  it("finds nothing to hide when the image is already the frame's shape", () => {
    expect(coverOverflow(FRAME, { w: 1920, h: 320 })).toEqual({ x: 0, y: 0 });
  });

  // The failure this guards against isn't cosmetic: an unmeasured frame used to
  // scale the preview image to 0x0, so the dialog showed an empty box.
  it("returns no overflow rather than NaN when a measurement is missing", () => {
    expect(coverOverflow(null, { w: 600, h: 400 })).toEqual({ x: 0, y: 0 });
    expect(coverOverflow(FRAME, null)).toEqual({ x: 0, y: 0 });
    expect(coverOverflow({ w: 0, h: 0 }, { w: 600, h: 400 })).toEqual({ x: 0, y: 0 });
  });
});

describe("dragToPosition", () => {
  const overflow = { x: 0, y: 300 };

  it("reveals the top of the image when dragged down", () => {
    expect(dragToPosition({ x: 50, y: 50 }, 0, 30, overflow).y).toBe(40);
  });

  it("reveals the bottom of the image when dragged up", () => {
    expect(dragToPosition({ x: 50, y: 50 }, 0, -30, overflow).y).toBe(60);
  });

  it("stops at the image's edges", () => {
    expect(dragToPosition({ x: 50, y: 50 }, 0, 9999, overflow).y).toBe(0);
    expect(dragToPosition({ x: 50, y: 50 }, 0, -9999, overflow).y).toBe(100);
  });

  it("centres an axis with nothing to choose", () => {
    expect(dragToPosition({ x: 50, y: 50 }, 200, 30, overflow).x).toBe(50);
  });
});
