/**
 * When the selection toolbar is offered.
 *
 * The predicate is tested directly rather than through the rendered popover:
 * BubbleMenu positions with floating-ui, which needs layout APIs jsdom does not
 * implement. The predicate is pure and is what actually decides visibility.
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
import { blocksToPmDoc } from "../blockAdapter";
import { shouldShowToolbar } from "./BubbleToolbar";
import type { Block } from "../blocks";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
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
  editor.commands.focus();
  // jsdom does not carry real focus, and the predicate legitimately requires it
  // (it fully replaces BubbleMenu's default, which checked focus itself).
  Object.defineProperty(editor, "isFocused", { value: true, configurable: true });
  return editor;
}

const paragraph = (text: string): Block => ({
  type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }],
});

function ask(editor: Editor, oldState?: Parameters<typeof shouldShowToolbar>[0]["oldState"]) {
  const { from, to } = editor.state.selection;
  return shouldShowToolbar({ editor, state: editor.state, oldState, from, to });
}

describe("toolbar visibility", () => {
  it("shows for a text selection", () => {
    const editor = mount([paragraph("hello world")]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(ask(editor)).toBe(true);
  });

  it("stays hidden for a plain click", () => {
    // Showing on a collapsed cursor was tried and reverted: the toolbar then
    // appeared on every click and tracked the caret while typing.
    const editor = mount([paragraph("hello world")]);
    editor.commands.setTextSelection(3);
    expect(ask(editor)).toBe(false);
  });

  it("stays hidden inside a code block", () => {
    // Inline marks do not apply there, and it covered the code.
    const editor = mount([{
      type: "codeBlock",
      props: { language: "rust" },
      content: [{ type: "text", text: "let x = 1;", styles: {} }],
    }]);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(ask(editor)).toBe(false);
  });

  it("stays hidden for a whitespace-only selection", () => {
    const editor = mount([paragraph("a    b")]);
    editor.commands.setTextSelection({ from: 2, to: 6 });
    expect(ask(editor)).toBe(false);
  });

  it("shows across a multi-block selection", () => {
    const editor = mount([paragraph("first"), paragraph("second")]);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    expect(ask(editor)).toBe(true);
  });

  it("stays hidden when the editor is not editable", () => {
    const editor = mount([paragraph("read only")]);
    editor.setEditable(false);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(ask(editor)).toBe(false);
  });
});
