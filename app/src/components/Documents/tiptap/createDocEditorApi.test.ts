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

describe("editing history", () => {
  it("exposes undo and redo with their current availability", () => {
    const { api } = makeEditor([paragraph("one")]);
    expect(api.canUndo()).toBe(false);
    api.insertBlocks([paragraph("two")], api.document[0], "after");
    expect(api.canUndo()).toBe(true);

    expect(api.undo()).toBe(true);
    expect(api.document).toHaveLength(1);
    expect(api.canRedo()).toBe(true);

    expect(api.redo()).toBe(true);
    expect(api.document).toHaveLength(2);
  });

  it("notifies controls when history changes and can unsubscribe", () => {
    const { api } = makeEditor([paragraph("one")]);
    const listener = vi.fn();
    const unsubscribe = api.onHistoryChange(listener);
    api.insertBlocks([paragraph("two")], api.document[0], "after");
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    api.undo();
    expect(listener).not.toHaveBeenCalled();
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
  it("keeps the caret in place when inserting a trailing block", () => {
    const { editor, api } = makeEditor([paragraph("1")]);
    editor.commands.setTextSelection(2);
    const before = editor.state.selection.from;

    api.insertBlocks([{ type: "paragraph" }], api.document[0], "after");

    expect(editor.state.selection.from).toBe(before);
    editor.commands.insertContent(".");
    expect(api.document[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "1." }),
    ]));
  });

  it("does not spread consecutive typing across newly appended paragraphs", () => {
    const { editor, api } = makeEditor([{ type: "paragraph", props: {} }]);
    editor.on("update", () => {
      const cursor = api.getTextCursorPosition();
      const hasText = Array.isArray(cursor.block.content) && cursor.block.content.length > 0;
      if (!cursor.nextBlock && hasText) {
        api.insertBlocks([{ type: "paragraph" }], cursor.block, "after");
      }
    });
    editor.commands.setTextSelection(1);

    editor.commands.insertContent("1");
    editor.commands.insertContent(".");
    editor.commands.insertContent(" ");

    expect(api.document).toHaveLength(2);
    expect(api.document[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "1. " }),
    ]));
  });

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

/**
 * `getTextCursorPosition` runs on every keystroke and used to do it by
 * serializing the whole document. The positional lookup that replaced it must
 * answer EXACTLY what the serialize-and-flatten route answered — the
 * trailing-paragraph affordance and the YouTube-paste promotion both key off
 * `nextBlock` and fail silently when it is wrong. So this suite keeps the old
 * algorithm as the reference and checks agreement across document shapes and
 * every valid cursor position.
 */
describe("getTextCursorPosition parity with whole-document flattening", () => {
  /** The old implementation, verbatim in shape: full serialize, flatten,
   *  then find the cursor's block by walking up to an id-bearing node. */
  function legacyCursor(editor: Editor) {
    const flattenBlocks = (blocks: Block[]): Block[] => {
      const out: Block[] = [];
      for (const block of blocks) {
        out.push(block);
        if (block.children?.length) out.push(...flattenBlocks(block.children));
      }
      return out;
    };
    const api = createDocEditorApi(editor);
    const blocks = flattenBlocks(api.document);
    const { $from } = editor.state.selection;
    let index = -1;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const id = $from.node(depth).attrs?.id;
      if (!id) continue;
      index = blocks.findIndex((block) => block.id === id);
      if (index >= 0) break;
    }
    if (index < 0) {
      // No id anywhere up the chain: the old code's top-level fallback.
      const topIndex = editor.state.doc.resolve($from.before(1)).index();
      index = Math.min(Math.max(topIndex, 0), blocks.length - 1);
    }
    return {
      block: blocks[index] ?? null,
      prevBlock: index > 0 ? blocks[index - 1] : null,
      nextBlock: index >= 0 && index < blocks.length - 1 ? blocks[index + 1] : null,
    };
  }

  const text = (t: string) => ({ type: "text" as const, text: t, styles: {} });
  const heading = (t: string, level = 2): Block => ({ type: "heading", props: { level }, content: [text(t)] });
  const bullet = (t: string, children: Block[] = []): Block => ({ type: "bulletListItem", props: {}, content: [text(t)], children });
  const numbered = (t: string, children: Block[] = []): Block => ({ type: "numberedListItem", props: {}, content: [text(t)], children });
  const task = (t: string, children: Block[] = []): Block => ({ type: "checkListItem", props: {}, content: [text(t)], children });
  const quote = (t: string): Block => ({ type: "quote", props: {}, content: [text(t)] });
  const code = (t: string): Block => ({ type: "codeBlock", props: { language: "text" }, content: [text(t)] });

  const SHAPES: Record<string, Block[]> = {
    paragraphs: [paragraph("alpha"), paragraph("beta"), paragraph("gamma")],
    "mixed block kinds": [
      heading("Title", 1),
      paragraph("body text"),
      quote("a quote"),
      code("const x = 1;"),
      paragraph("tail"),
    ],
    "flat lists": [bullet("one"), bullet("two"), numbered("three"), numbered("four"), task("five")],
    "nested lists": [
      bullet("outer one", [bullet("inner a"), bullet("inner b", [bullet("deep i")]), bullet("inner c")]),
      bullet("outer two"),
      paragraph("after"),
    ],
    "nested mixed lists": [
      numbered("first", [bullet("nested bullet"), task("nested task", [numbered("deep")])]),
      numbered("second"),
    ],
    "lists then paragraphs": [bullet("item"), paragraph("plain"), bullet("again"), paragraph("end")],
    "table and quote": [
      paragraph("before"),
      {
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          columnWidths: [],
          rows: [
            { cells: [
              { type: "tableCell", content: [text("a1")], props: { colspan: 1, rowspan: 1, backgroundColor: "default", textColor: "default", textAlignment: "left" } },
              { type: "tableCell", content: [text("a2")], props: { colspan: 1, rowspan: 1, backgroundColor: "default", textColor: "default", textAlignment: "left" } },
            ] },
            { cells: [
              { type: "tableCell", content: [text("b1")], props: { colspan: 1, rowspan: 1, backgroundColor: "default", textColor: "default", textAlignment: "left" } },
              { type: "tableCell", content: [text("b2")], props: { colspan: 1, rowspan: 1, backgroundColor: "default", textColor: "default", textAlignment: "left" } },
            ] },
          ],
        },
      } as unknown as Block,
      paragraph("after"),
    ],
    "atom blocks": [
      paragraph("top"),
      { type: "divider", props: {} } as unknown as Block,
      paragraph("bottom"),
    ],
  };

  /** A position inside every text node, so a shape is checked from within
   *  each kind of block rather than from a couple of hand-picked spots. */
  function* textPositions(editor: Editor): Generator<number> {
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      positions.push(pos + 1); // just inside the text node
      if ((node.text?.length ?? 0) > 2) positions.push(pos + node.nodeSize - 1);
      return false;
    });
    yield* positions;
  }

  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`agrees on "${name}" at every cursor position`, () => {
      const { editor, api } = makeEditor(shape);
      let checked = 0;
      for (const pos of textPositions(editor)) {
        editor.commands.setTextSelection(pos);
        const expected = legacyCursor(editor);
        const actual = api.getTextCursorPosition();
        const simplify = (b: Block | null) => b && ({ id: b.id, type: b.type, content: JSON.stringify(b.content ?? null) });
        expect({ pos, ...{ b: simplify(actual.block), p: simplify(actual.prevBlock), n: simplify(actual.nextBlock) } })
          .toEqual({ pos, b: simplify(expected.block), p: simplify(expected.prevBlock), n: simplify(expected.nextBlock) });
        checked += 1;
      }
      expect(checked).toBeGreaterThan(2);
    });
  }

  it("stays sane on a NodeSelection over an atom block", () => {
    const divider = { type: "divider", props: {} } as unknown as Block;
    const { editor, api } = makeEditor([paragraph("top"), divider, paragraph("bottom")]);
    // A top-level NodeSelection sits between nodes, with no ancestor at all
    // — where the old id-walk had no answer. The lookup must still anchor.
    editor.commands.setNodeSelection(5);
    const actual = api.getTextCursorPosition();
    expect(actual.block.type).toBe("divider");
    expect(actual.prevBlock && JSON.stringify(actual.prevBlock.content)).toContain("top");
    expect(actual.nextBlock && JSON.stringify(actual.nextBlock.content)).toContain("bottom");
  });

  it("only converts the cursor's own block, not the document", () => {
    // The performance contract in executable form: building the answer costs
    // the cursor's block, so many blocks + a big text body must not show up
    // in the JSON round trip the getter performs per keystroke.
    const big: Block[] = [];
    for (let i = 0; i < 500; i += 1) big.push(paragraph(`line ${i} ${"x".repeat(200)}`));
    const { editor, api } = makeEditor(big);
    editor.commands.setTextSelection(2);
    const spy = vi.spyOn(editor.state.doc, "toJSON");
    api.getTextCursorPosition();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("export input path", () => {
  // documentExport.ts builds HTML/PDF from `blocksToHTMLLossy(api.document)`
  // and then post-processes that exact HTML: mermaid renders by `pre.mermaid`,
  // code highlights by `pre > code[data-language]`, and a mermaid-language
  // code fence normalizes by the literal regex
  // `<pre[^>]*data-language="mermaid"[^>]*><code[^>]*>` — the shape is the
  // contract, and both ends must agree or the pipeline silently no-ops.
  it("serializes the live document in the shape the export pipeline expects", () => {
    const { api } = makeEditor([
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Exportable", styles: {} }] },
      { type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: "const a = 1;", styles: {} }] },
      { type: "mermaid", props: { code: "graph TD\n A-->B" } },
    ]);
    const html = api.blocksToHTMLLossy(api.document);
    expect(html).toContain("<h2");
    expect(html).toContain("Exportable");
    expect(html).toContain('<pre class="mermaid">');

    const holder = document.createElement("div");
    holder.innerHTML = html;
    const code = holder.querySelector('pre > code[data-language="javascript"]');
    expect(code?.textContent).toContain("const a = 1;");
  });

  it("serializes a mermaid-language fence so the export normalizer catches it", () => {
    // In markdown exports a ```mermaid fence stays a code block until
    // `normalizeMermaidFences` rewrites it — via this exact regex.
    const { api } = makeEditor([
      { type: "codeBlock", props: { language: "mermaid" }, content: [{ type: "text", text: "graph TD", styles: {} }] },
    ]);
    const html = api.blocksToHTMLLossy(api.document);
    const normalize = /<pre[^>]*data-language="mermaid"[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g;
    expect(html.replace(normalize, "MATCHED")).toContain("MATCHED");
  });
});
