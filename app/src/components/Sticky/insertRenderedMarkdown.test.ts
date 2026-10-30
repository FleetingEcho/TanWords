import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { insertRenderedMarkdown } from "./insertRenderedMarkdown";

describe("insertRenderedMarkdown", () => {
  it("inserts headings, lists and Mermaid as rendered editor blocks", async () => {
    let inserted: unknown;
    const chain = {
      focus: () => chain,
      insertContent: (content: unknown) => { inserted = content; return chain; },
      run: () => true,
    };
    const editor = { isDestroyed: false, chain: () => chain } as unknown as Editor;

    expect(await insertRenderedMarkdown(editor, "# Heading\n\n- one\n- two\n\n```mermaid\ngraph TD\n A-->B\n```"))
      .toBe(true);
    const nodes = inserted as Array<{ type: string; content?: unknown[] }>;
    expect(nodes.map((node) => node.type)).toContain("heading");
    expect(nodes.map((node) => node.type)).toContain("bulletList");
    expect(nodes.map((node) => node.type)).toContain("mermaid");
  });

  it("leaves the editor alone for an empty clipboard", async () => {
    const chain = vi.fn();
    const editor = { isDestroyed: false, chain } as unknown as Editor;
    expect(await insertRenderedMarkdown(editor, "  \n ")).toBe(false);
    expect(chain).not.toHaveBeenCalled();
  });
});
