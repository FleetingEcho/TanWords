/**
 * The `DocEditorApi` implementation over Tiptap.
 *
 * `getTextCursorPosition` gets the most attention here because it is the
 * subtlest method in the port (plan.md §3): the trailing-paragraph affordance
 * and the pasted-YouTube-link promotion both key off `nextBlock`, and both
 * fail *silently* when it is wrong.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { Editor } from "@tiptap/core";
import { buildExtensions } from "./schema";
import { createDocEditorApi } from "./createDocEditorApi";
import { blocksToPmDoc } from "./blockAdapter";
import type { Block } from "./blocks";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

function makeEditor(blocks: Block[]) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: buildExtensions(),
    content: blocksToPmDoc(blocks) as never,
  });
  editors.push(editor);
  return { editor, api: createDocEditorApi(editor) };
}

function paragraph(text: string): Block {
  return { type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }] };
}

describe("document access", () => {
  it("reads the document back in storage format", () => {
    const { api } = makeEditor([paragraph("one"), paragraph("two")]);
    expect(api.document.map((block) => block.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("replaces the whole document", () => {
    const { api } = makeEditor([paragraph("old")]);
    api.replaceBlocks(api.document, [paragraph("new"), paragraph("newer")]);
    expect(api.document).toHaveLength(2);
  });

  it("does not mark the document dirty when loading content", () => {
    // Loading is not a user edit. Emitting an update here would schedule a
    // save that rewrites the file the editor just read.
    const { editor, api } = makeEditor([paragraph("old")]);
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    api.replaceBlocks(api.document, [paragraph("loaded")]);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("getTextCursorPosition", () => {
  it("reports no nextBlock at the end of the document", () => {
    const { editor, api } = makeEditor([paragraph("one"), paragraph("last")]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const cursor = api.getTextCursorPosition();
    expect(cursor.nextBlock).toBeNull();
  });

  it("reports a nextBlock anywhere else", () => {
    const { editor, api } = makeEditor([paragraph("one"), paragraph("two")]);
    editor.commands.setTextSelection(2);
    const cursor = api.getTextCursorPosition();
    expect(cursor.nextBlock).not.toBeNull();
  });

  it("reports the block the cursor is actually in", () => {
    const { editor, api } = makeEditor([paragraph("first"), paragraph("second")]);
    editor.commands.setTextSelection(2);
    expect(JSON.stringify(api.getTextCursorPosition().block)).toContain("first");
  });

  it("resolves to the list item when the cursor is nested", () => {
    const { editor, api } = makeEditor([
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "item", styles: {} }] },
    ]);
    editor.commands.setTextSelection(3);
    expect(api.getTextCursorPosition().block.type).toBe("bulletListItem");
  });
});

describe("block mutation", () => {
  it("inserts after a reference block", () => {
    const { api } = makeEditor([paragraph("one"), paragraph("three")]);
    api.insertBlocks([paragraph("two")], api.document[0], "after");
    expect(JSON.stringify(api.document[1])).toContain("two");
  });

  it("inserts before a reference block", () => {
    const { api } = makeEditor([paragraph("second")]);
    api.insertBlocks([paragraph("first")], api.document[0], "before");
    expect(JSON.stringify(api.document[0])).toContain("first");
  });

  it("removes blocks by id", () => {
    const { api } = makeEditor([paragraph("keep"), paragraph("drop")]);
    const target = api.document[1];
    api.removeBlocks([target.id!]);
    expect(api.document).toHaveLength(1);
    expect(JSON.stringify(api.document)).toContain("keep");
  });

  it("removes several blocks without positions shifting underneath it", () => {
    const { api } = makeEditor([paragraph("a"), paragraph("b"), paragraph("c")]);
    const ids = [api.document[0].id!, api.document[2].id!];
    api.removeBlocks(ids);
    expect(api.document).toHaveLength(1);
    expect(JSON.stringify(api.document)).toContain("b");
  });

  it("updates a block's props", () => {
    const { api } = makeEditor([
      { type: "mermaid", props: { code: "graph TD\n A-->B" } },
    ]);
    api.updateBlock(api.document[0], { props: { code: "graph LR\n X-->Y" } });
    expect(api.document[0].props?.code).toBe("graph LR\n X-->Y");
  });
});

describe("selection", () => {
  it("returns nothing when nothing is selected", () => {
    const { api } = makeEditor([paragraph("text")]);
    expect(api.getSelection()).toBeUndefined();
    expect(api.getSelectedText()).toBe("");
  });

  it("returns the selected text", () => {
    const { editor, api } = makeEditor([paragraph("hello world")]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(api.getSelectedText()).toBe("hello");
  });

  it("returns the blocks a selection spans", () => {
    const { editor, api } = makeEditor([paragraph("one"), paragraph("two")]);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    expect(api.getSelection()?.blocks.length).toBe(2);
  });
});

describe("cursor placement", () => {
  it("moves the cursor to a block by id, which is how the outline navigates", () => {
    const { editor, api } = makeEditor([
      paragraph("one"),
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Target", styles: {} }] },
    ]);
    const heading = api.document[1];
    api.setTextCursorPosition(heading.id!, "start");
    expect(api.getTextCursorPosition().block.type).toBe("heading");
    expect(editor.state.selection.empty).toBe(true);
  });
});

/**
 * React DevTools enumerates the properties of objects it renders, which
 * *invokes* getters. The API is handed to callers via `onReady` and lives in
 * component state, so any getter that reaches into an unmounted editor view
 * throws during commit — which is what "Should not already be working" was.
 */
describe("safe to enumerate", () => {
  it("never throws when every property is read, even after destroy", () => {
    const { editor, api } = makeEditor([paragraph("text")]);
    editor.destroy();
    // Exactly what a property-diffing devtool does.
    const enumerated = api as unknown as Record<string, unknown>;
    expect(() => {
      for (const key of Object.keys(enumerated)) enumerated[key];
    }).not.toThrow();
  });

  it("keeps `document` off the enumerable surface", () => {
    // Enumerable, it would re-serialize the whole document on every render in
    // development, where React diffs state by walking Object.keys.
    const { api } = makeEditor([paragraph("text")]);
    expect(Object.keys(api)).not.toContain("document");
    expect(api.document).toHaveLength(1); // still readable as a field
  });

  it("reports no view DOM once the editor is destroyed", () => {
    const { editor, api } = makeEditor([paragraph("text")]);
    editor.destroy();
    expect(api.getViewDom()).toBeNull();
  });

  it("exposes the view DOM while mounted", () => {
    const { api } = makeEditor([paragraph("text")]);
    expect(api.getViewDom()).toBeInstanceOf(HTMLElement);
  });
});
