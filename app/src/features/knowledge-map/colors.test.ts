import { describe, expect, it } from "vitest";
import { NODE_KIND_COLORS } from "./colors";
import type { KnowledgeNodeKind } from "./types";

describe("NODE_KIND_COLORS", () => {
  it("defines a color for every node kind", () => {
    const kinds: KnowledgeNodeKind[] = ["topic", "category", "word", "phrase", "situation", "contrast"];
    kinds.forEach((kind) => {
      expect(NODE_KIND_COLORS[kind]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});
