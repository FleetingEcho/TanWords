import { describe, expect, it } from "vitest";
import { calculateDocumentScrollbar } from "./DocumentPreviewScrollArea";

describe("calculateDocumentScrollbar", () => {
  it("keeps a full-height thumb visible when content does not overflow", () => {
    expect(calculateDocumentScrollbar(400, 300, 0)).toEqual({
      top: 8,
      height: 384,
      scrollable: false,
    });
  });

  it("moves a persistent thumb with a scrolling document", () => {
    const top = calculateDocumentScrollbar(400, 1200, 0);
    const bottom = calculateDocumentScrollbar(400, 1200, 800);
    expect(top).toEqual({ top: 8, height: 128, scrollable: true });
    expect(bottom).toEqual({ top: 264, height: 128, scrollable: true });
  });
});
