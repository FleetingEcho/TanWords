/**
 * The `/` insert menu.
 *
 * Asserted at the plugin-state boundary, not the rendered popover: the
 * Suggestion plugin's own view calls floating-ui, which needs
 * `getClientRects` — jsdom does not implement it, so the render callbacks never
 * run here. Its `active`/`query` state is computed synchronously from the
 * document and *is* verifiable, and it is what decides whether the menu opens.
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
import { buildSlashItems, filterSlashItems } from "./slashItems";
import { insertBlockBelow } from "./SideMenu";
import type { Block } from "../blocks";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

function mount(text = "existing") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const blocks: Block[] = [
    { type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }] },
  ];
  const editor = new Editor({
    element,
    extensions: buildExtensions({ label: (key) => key }),
    content: blocksToPmDoc(blocks) as never,
  });
  editors.push(editor);
  return editor;
}

/** The Suggestion plugin's state: whether the menu would open, and on what. */
function suggestionState(editor: Editor) {
  const plugin = editor.state.plugins.find((candidate) =>
    String((candidate as { key?: string }).key ?? "").startsWith("suggestion"),
  ) as { getState(state: unknown): { active: boolean; query: string | null } } | undefined;
  return plugin?.getState(editor.state);
}

describe("the / trigger", () => {
  it("activates when a block starts with /", () => {
    const editor = mount();
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
      type: "paragraph", content: [{ type: "text", text: "/" }],
    }).run();
    expect(suggestionState(editor)?.active).toBe(true);
  });

  it("carries the typed query", () => {
    const editor = mount();
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
      type: "paragraph", content: [{ type: "text", text: "/tab" }],
    }).run();
    expect(suggestionState(editor)?.query).toBe("tab");
  });

  it("stays inactive for a / inside a sentence", () => {
    // `and/or` must not open a block menu mid-word.
    const editor = mount("and/or");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(suggestionState(editor)?.active).toBe(false);
  });
});

describe("the + button", () => {
  it("opens the menu on a new block below the target", () => {
    // Regression: it used to insert an empty paragraph, so the Suggestion
    // plugin had no trigger to match and the button looked inert.
    const editor = mount();
    const first = editor.state.doc.firstChild!;
    insertBlockBelow(editor, { node: first, pos: 0 });

    expect(suggestionState(editor)?.active).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("leaves the original block untouched", () => {
    const editor = mount("keep me");
    insertBlockBelow(editor, { node: editor.state.doc.firstChild!, pos: 0 });
    expect(editor.state.doc.firstChild?.textContent).toBe("keep me");
  });

  it("does nothing when no block is hovered", () => {
    const editor = mount();
    const before = editor.state.doc.childCount;
    insertBlockBelow(editor, { node: null, pos: -1 });
    expect(editor.state.doc.childCount).toBe(before);
  });
});

describe("the item list", () => {
  const items = buildSlashItems({ from: 0, to: 1 });

  it("offers every block type the editor can insert", () => {
    const ids = items.map((item) => item.id);
    for (const expected of [
      "paragraph", "heading1", "heading2", "heading3", "bulletList",
      "orderedList", "taskList", "quote", "codeBlock", "table",
      "divider", "mermaid", "youtube",
    ]) {
      expect(ids, `missing slash item: ${expected}`).toContain(expected);
    }
  });

  it("filters on keywords as well as labels", () => {
    const byKeyword = filterSlashItems(items, "todo", (key) => key);
    expect(byKeyword.map((item) => item.id)).toContain("taskList");
  });

  it("returns everything for an empty query", () => {
    expect(filterSlashItems(items, "", (key) => key)).toHaveLength(items.length);
  });
});
