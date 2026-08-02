import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

import { BlockNoteEditor } from "@blocknote/core";
import { editorSchema } from "@/components/Documents/editorSchema";

describe("read-only article parsing", () => {
  it("parses common article HTML into BlockNote blocks", () => {
    const editor = BlockNoteEditor.create({ schema: editorSchema });
    const blocks = editor.tryParseHTMLToBlocks(`
      <h1>Title</h1>
      <p>Hello <strong>world</strong> and <a href="https://example.com">link</a>.</p>
      <ul><li>one</li><li>two</li></ul>
      <blockquote>quote</blockquote>
      <pre><code class="language-javascript">const x = 1;</code></pre>
    `);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((block) => block.type === "heading")).toBe(true);
    expect(blocks.some((block) => block.type === "bulletListItem")).toBe(true);
    expect(blocks.some((block) => block.type === "codeBlock")).toBe(true);
  });
});
