import { describe, expect, it } from "vitest";
import { isLargeDocumentBlocks, isLargeDocumentText } from "./largeDocument";
import type { Block } from "./tiptap/blocks";

describe("large document routing", () => {
  it("keeps ordinary notes in the rich editor", () => {
    expect(isLargeDocumentText("# Note\n\nA short document." )).toBe(false);
    expect(isLargeDocumentBlocks([{ type: "paragraph" }] as Block[])).toBe(false);
  });

  it("routes very long text to the virtualized raw editor", () => {
    expect(isLargeDocumentText("x".repeat(150_000))).toBe(true);
  });

  it("routes documents with thousands of small blocks away from ProseMirror", () => {
    const blocks = Array.from({ length: 2_000 }, () => ({ type: "paragraph" })) as Block[];
    expect(isLargeDocumentBlocks(blocks)).toBe(true);
  });
});
