/**
 * The block menu's actions.
 *
 * Tested as functions against a real editor rather than through the menu: the
 * menu positions itself with floating-ui, which jsdom cannot lay out, and the
 * behaviour that matters is what happens to the document.
 *
 * Each acts on an explicit block position, not the cursor — the handle operates
 * on the block you are pointing at, which is usually not the one with the caret.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { Editor } from "@tiptap/core";
import { buildExtensions } from "../schema";
import { blocksToPmDoc, pmDocToBlocks } from "../blockAdapter";
import {
  TURN_INTO_OPTIONS, blockTextForAi, copyBlockText, deleteBlock,
  duplicateBlock, resetFormatting, turnInto,
} from "./blockActions";
import type { Block } from "../blocks";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

const paragraph = (text: string): Block => ({
  type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }],
});

function mount(blocks: Block[]) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: buildExtensions(),
    content: blocksToPmDoc(blocks) as never,
  });
  editors.push(editor);
  return editor;
}

/** The first block, as the drag handle would report it. */
function firstBlock(editor: Editor) {
  return { node: editor.state.doc.firstChild!, pos: 0 };
}

function types(editor: Editor) {
  return pmDocToBlocks(editor.getJSON() as never).map((block) => block.type);
}

describe("turn into", () => {
  it.each(TURN_INTO_OPTIONS.map((option) => option.id))("converts to %s", (optionId) => {
    const editor = mount([paragraph("convert me")]);
    turnInto(editor, firstBlock(editor), optionId);
    // Whatever it became, the text survives and it is no longer a bare
    // paragraph (except when paragraph is what was asked for).
    expect(editor.state.doc.textContent).toContain("convert me");
    if (optionId !== "paragraph") {
      expect(types(editor)[0]).not.toBe("paragraph");
    }
  });

  it("converts a heading back to a paragraph", () => {
    const editor = mount([
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Title", styles: {} }] },
    ]);
    turnInto(editor, firstBlock(editor), "paragraph");
    expect(types(editor)[0]).toBe("paragraph");
  });

  it("ignores an unknown option", () => {
    const editor = mount([paragraph("unchanged")]);
    turnInto(editor, firstBlock(editor), "not-an-option");
    expect(types(editor)[0]).toBe("paragraph");
  });
});

describe("duplicate", () => {
  it("inserts a copy directly below", () => {
    const editor = mount([paragraph("original"), paragraph("after")]);
    duplicateBlock(editor, firstBlock(editor));
    const text = pmDocToBlocks(editor.getJSON() as never)
      .map((block) => JSON.stringify(block.content));
    expect(text[0]).toContain("original");
    expect(text[1]).toContain("original");
    expect(text[2]).toContain("after");
  });

  it("duplicates a code block with its language", () => {
    const editor = mount([
      { type: "codeBlock", props: { language: "rust" }, content: [{ type: "text", text: "let x = 1;", styles: {} }] },
    ]);
    duplicateBlock(editor, firstBlock(editor));
    const blocks = pmDocToBlocks(editor.getJSON() as never);
    expect(blocks[1].type).toBe("codeBlock");
    expect((blocks[1].props as Record<string, unknown>).language).toBe("rust");
  });
});

describe("copy and AI", () => {
  it("returns the block's text", () => {
    const editor = mount([paragraph("copy this")]);
    expect(copyBlockText(editor, firstBlock(editor))).toBe("copy this");
  });

  it("hands the block's text to AI Chat", () => {
    const editor = mount([paragraph("  explain this  ")]);
    expect(blockTextForAi(editor, firstBlock(editor))).toBe("explain this");
  });
});

describe("reset formatting", () => {
  it("strips marks but keeps the text and block type", () => {
    const editor = mount([{
      type: "heading",
      props: { level: 2 },
      content: [
        { type: "text", text: "bold", styles: { bold: true } },
        { type: "text", text: " plain", styles: {} },
      ],
    }]);
    resetFormatting(editor, firstBlock(editor));
    const [block] = pmDocToBlocks(editor.getJSON() as never);
    expect(block.type).toBe("heading");
    expect(JSON.stringify(block.content)).not.toContain("bold\":true");
    expect(editor.state.doc.textContent).toBe("bold plain");
  });
});

describe("delete", () => {
  it("removes the target block and leaves the rest", () => {
    const editor = mount([paragraph("goes"), paragraph("stays")]);
    deleteBlock(editor, firstBlock(editor));
    expect(editor.state.doc.textContent).toBe("stays");
  });
});

describe("guards", () => {
  it.each([
    ["duplicate", duplicateBlock],
    ["reset", resetFormatting],
    ["delete", deleteBlock],
  ])("%s does nothing without a target", (_label, action) => {
    const editor = mount([paragraph("untouched")]);
    action(editor, { node: null, pos: -1 });
    expect(editor.state.doc.textContent).toBe("untouched");
  });

  it("copy returns null without a target", () => {
    const editor = mount([paragraph("x")]);
    expect(copyBlockText(editor, { node: null, pos: -1 })).toBeNull();
  });
});
