import { describe, expect, it } from "vitest";
import { countTaskBlocks } from "./taskCounts";

describe("countTaskBlocks", () => {
  it("counts nested checklist blocks and checked state", () => {
    const content = JSON.stringify([
      { type: "paragraph", content: [{ type: "text", text: "hi" }] },
      { type: "checkListItem", props: { checked: true }, content: "done" },
      {
        type: "checkListItem",
        props: { checked: false },
        content: "todo",
        children: [{ type: "checkListItem", props: { checked: true }, content: "nested" }],
      },
    ]);
    expect(countTaskBlocks(content)).toEqual({ total: 3, done: 2 });
  });

  it("ignores non-checklist blocks even when they carry a checked prop", () => {
    const content = JSON.stringify([
      { type: "bulletListItem", props: { checked: true } },
      { type: "heading", props: { checked: true } },
    ]);
    expect(countTaskBlocks(content)).toEqual({ total: 0, done: 0 });
  });

  it("returns zero for malformed or empty content rather than throwing", () => {
    expect(countTaskBlocks("not json")).toEqual({ total: 0, done: 0 });
    expect(countTaskBlocks("")).toEqual({ total: 0, done: 0 });
    expect(countTaskBlocks("42")).toEqual({ total: 0, done: 0 });
  });

  it("matches the Rust counter on an object-wrapped root with children", () => {
    const content = JSON.stringify({ type: "doc", children: [{ type: "checkListItem", props: { checked: false } }] });
    expect(countTaskBlocks(content)).toEqual({ total: 1, done: 0 });
  });
});