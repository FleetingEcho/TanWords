/**
 * Validates the adapter's output against the *real* ProseMirror schema.
 *
 * `blockAdapter.test.ts` is pure JSON⇄JSON, which cannot catch a doc that is
 * well-shaped but rejected by the schema — a node name that does not exist, an
 * attr the node never declared, content in an atom. Those only surface when
 * ProseMirror actually parses the document, which is what this file does.
 */
import { describe, it, expect, vi } from "vitest";

// The schema imports React node views -> useT -> settingsStore, which touches
// matchMedia at import time.
vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { getSchema } from "@tiptap/core";
import { markdownToBlocks } from "@/lib/markdown";
import { blocksToPmDoc, pmDocToBlocks } from "./blockAdapter";
import { buildExtensions } from "./schema";
import type { Block } from "./blocks";

const schema = getSchema(buildExtensions());

function parse(markdown: string): Block[] {
  return markdownToBlocks(markdown);
}

/** Parses through the real schema, which throws on anything invalid. */
function intoSchema(blocks: Block[]) {
  return schema.nodeFromJSON(blocksToPmDoc(blocks));
}

/** Ids are assigned by the editor and are not part of the content contract. */
function normalize(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    const { id: _id, children, ...rest } = block;
    const out: Block = { ...rest };
    if (children?.length) out.children = normalize(children);
    return out;
  });
}

describe("the schema accepts everything the adapter emits", () => {
  it.each([
    ["headings", "# One\n\n## Two"],
    ["styled text", "**bold** *italic* `code` ~~strike~~"],
    ["links", "[a link](https://example.com)"],
    ["bullet list", "- one\n- two"],
    ["ordered list", "1. one\n2. two"],
    ["task list", "- [ ] todo\n- [x] done"],
    ["nested list", "- one\n  - nested\n    - deeper"],
    ["blockquote", "> quoted"],
    ["code block", "```ts\nconst x = 1;\n```"],
    ["divider", "a\n\n---\n\nb"],
    ["image", "![alt](https://example.com/a.png)"],
    ["table", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ])("parses %s without the schema rejecting it", async (_label, markdown) => {
    const blocks = parse(markdown);
    expect(() => intoSchema(blocks)).not.toThrow();
  });

  it.each([
    ["mermaid", { type: "mermaid", props: { code: "graph TD\n A-->B" } }],
    ["youtube", { type: "youtube", props: { url: "https://youtu.be/aR97E7aKEgg", caption: "c" } }],
    ["image", { type: "image", props: { url: "tanwords-asset://a", name: "i.png", caption: "" } }],
    ["video", { type: "video", props: { url: "tanwords-asset://b", name: "v.mp4" } }],
    ["audio", { type: "audio", props: { url: "tanwords-asset://c", name: "a.mp3" } }],
    ["file", { type: "file", props: { url: "tanwords-asset://d", name: "f.pdf" } }],
  ])("accepts the custom %s node", (_label, block) => {
    expect(() => intoSchema([block as Block])).not.toThrow();
  });

  it("survives a real ProseMirror parse and comes back unchanged", async () => {
    const blocks = parse([
      "# Title",
      "Body with **bold** and a [link](https://example.com).",
      "- one\n- two\n  - nested",
      "- [ ] todo",
      "> quoted",
      "```js\nconst a = 1;\n```",
    ].join("\n\n"));

    // Through the schema and back out — the trip a real editor performs.
    const returned = pmDocToBlocks(intoSchema(blocks).toJSON());
    expect(normalize(returned)).toEqual(normalize(blocks));
  });

  it("keeps a list item's stored alignment through the real schema", () => {
    // `textAlignment` on list items/cells is only carried when TextAlign's
    // `types` include them — the schema otherwise discards the attr and
    // BlockNote-era aligned lists silently reset on load.
    const returned = pmDocToBlocks(intoSchema([{
      type: "bulletListItem",
      props: { backgroundColor: "default", textColor: "default", textAlignment: "center" },
      content: [{ type: "text", text: "hi", styles: {} }],
    }]).toJSON());
    expect(returned[0].props).toMatchObject({ textAlignment: "center" });
  });

  it("keeps table column widths through the real schema", () => {
    // The geometry rides on the table node's attrs; a Table extension that
    // declares no attributes drops it on parse.
    const table: Block = {
      type: "table",
      props: { textColor: "default" },
      content: {
        type: "tableContent",
        columnWidths: [120, 240],
        headerRows: 1,
        rows: [{ cells: [{ type: "tableCell", content: [], props: { colspan: 1, rowspan: 1, backgroundColor: "default", textColor: "default", textAlignment: "left" } }] }],
      },
    };
    const returned = pmDocToBlocks(intoSchema([table]).toJSON());
    expect((returned[0].content as { columnWidths: number[] }).columnWidths).toEqual([120, 240]);
  });

  it("does not leak the editor's id attr into stored props", () => {
    // `id` is a block-level field in the storage format. Landing it in props
    // would change the serialized content of every document the editor opens.
    const returned = pmDocToBlocks(intoSchema([{
      type: "paragraph",
      props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: "hi", styles: {} }],
    }]).toJSON());
    expect(returned[0].props).not.toHaveProperty("id");
  });

  it("preserves a non-default block colour through the real schema", () => {
    // Defaults mask this: only a *changed* colour is lost when the schema
    // never declared the attr.
    const returned = pmDocToBlocks(intoSchema([{
      type: "paragraph",
      props: { backgroundColor: "blue", textColor: "red", textAlignment: "center" },
      content: [{ type: "text", text: "hi", styles: {} }],
    }]).toJSON());
    expect(returned[0].props).toMatchObject({
      backgroundColor: "blue",
      textColor: "red",
      textAlignment: "center",
    });
  });

  it("round-trips a stored block id rather than renumbering it", () => {
    const returned = pmDocToBlocks(intoSchema([{
      id: "keep-me",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Heading", styles: {} }],
    }]).toJSON());
    expect(returned[0].id).toBe("keep-me");
  });

  it("keeps an asset URL intact through a real schema parse", () => {
    const block: Block = {
      type: "image",
      props: { url: "tanwords-asset://5f1c", name: "shot.png", caption: "" },
    };
    const returned = pmDocToBlocks(intoSchema([block]).toJSON());
    expect((returned[0].props as Record<string, unknown>).url).toBe("tanwords-asset://5f1c");
  });
});

describe("schema shape", () => {
  it("registers every block type the storage format uses", () => {
    for (const name of [
      "paragraph", "heading", "bulletList", "orderedList", "listItem",
      "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule",
      "table", "tableRow", "tableCell", "tableHeader",
      "image", "video", "audio", "file", "mermaid", "youtube",
    ]) {
      expect(schema.nodes[name], `missing node: ${name}`).toBeDefined();
    }
  });

  it("registers every inline style as a mark", () => {
    for (const name of ["bold", "italic", "underline", "strike", "code", "link"]) {
      expect(schema.marks[name], `missing mark: ${name}`).toBeDefined();
    }
  });

  it("treats media and custom blocks as atoms", () => {
    for (const name of ["image", "video", "audio", "file", "mermaid", "youtube"]) {
      expect(schema.nodes[name].isAtom, `${name} should be an atom`).toBe(true);
    }
  });
});
