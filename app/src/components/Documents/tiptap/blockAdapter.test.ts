/**
 * Round-trip fidelity for the storage format ⇄ ProseMirror boundary.
 *
 * Fixtures come from the *real* parser rather than block literals written by
 * hand — the same lesson `mediaTransforms.markdown.test.ts` records: a suite
 * asserting on shapes the author invented keeps passing while the feature is
 * broken. Whatever the app actually stores today is what must survive.
 */
import { describe, it, expect } from "vitest";
import { markdownToBlocks } from "@/lib/markdown";
import { blocksToPmDoc, pmDocToBlocks } from "./blockAdapter";
import type { Block } from "./blocks";

function parse(markdown: string): Block[] {
  return markdownToBlocks(markdown);
}

/** Ids are assigned by the editor, not by the content, so they are not part of
 *  the round-trip contract. Empty `children` is likewise incidental. */
function normalize(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    const { id: _id, children, ...rest } = block;
    const normalized: Block = { ...rest };
    if (children?.length) normalized.children = normalize(children);
    return normalized;
  });
}

function roundTrip(blocks: Block[]): Block[] {
  return normalize(pmDocToBlocks(blocksToPmDoc(blocks)));
}

async function expectStable(markdown: string) {
  const blocks = parse(markdown);
  expect(roundTrip(blocks)).toEqual(normalize(blocks));
}

describe("block ⇄ ProseMirror round trip", () => {
  it.each([
    ["headings", "# One\n\n## Two\n\n### Three"],
    ["paragraphs", "First para.\n\nSecond para."],
    ["inline styles", "Some **bold** and *italic* and `code` here."],
    ["links", "Text with [a link](https://example.com) inline."],
    ["a link beside styles", "**bold** then [link](https://a.test) then *em*"],
    ["bullet list", "- one\n- two\n- three"],
    ["ordered list", "1. first\n2. second"],
    ["task list", "- [ ] todo\n- [x] done"],
    ["nested bullets", "- one\n- two\n  - nested\n  - also nested"],
    ["adjacent lists of different types", "- bullet\n\n1. number"],
    ["blockquote", "> quoted text"],
    ["code block", "```ts\nconst x: number = 1;\n```"],
    ["divider", "text\n\n---\n\nmore"],
    ["image", "![alt text](https://example.com/a.png)"],
    ["table", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ])("preserves %s", async (_label, markdown) => {
    await expectStable(markdown);
  });

  it("preserves a document mixing everything", async () => {
    await expectStable([
      "# Title",
      "Intro with **bold**, a [link](https://example.com) and `code`.",
      "- one\n- two\n  - nested",
      "1. first\n2. second",
      "- [ ] todo\n- [x] done",
      "> a quote",
      "```js\nconst a = 1;\n```",
      "| h1 | h2 |\n|----|----|\n| a  | b  |",
      "![img](https://example.com/i.png)",
      "---",
      "Closing paragraph.",
    ].join("\n\n"));
  });
});

describe("custom and media blocks", () => {
  it.each([
    ["mermaid", { type: "mermaid", props: { code: "graph TD\n  A --> B" } }],
    ["youtube", { type: "youtube", props: { url: "https://youtu.be/aR97E7aKEgg", caption: "hi" } }],
    ["video", { type: "video", props: { url: "tanwords-asset://abc", name: "clip.mp4" } }],
    ["audio", { type: "audio", props: { url: "tanwords-asset://def", name: "a.mp3" } }],
    ["file", { type: "file", props: { url: "tanwords-asset://ghi", name: "doc.pdf" } }],
  ])("round-trips a %s block with its props intact", (_label, block) => {
    expect(roundTrip([block as Block])).toEqual([block]);
  });

  it("keeps the asset URL addressable after a round trip", () => {
    // pruneDocumentAssets regex-scans serialized content for these ids; losing
    // the URL here means the next autosave deletes the user's file (plan §4c).
    const block = { type: "image", props: { url: "tanwords-asset://5f1c", name: "shot.png", caption: "", showPreview: true } };
    const out = roundTrip([block as Block]);
    expect(JSON.stringify(out)).toContain("tanwords-asset://5f1c");
  });
});

/** The canary for the whole "keep the block array" bet (plan.md §2): if the
 *  adapter is faithful, every consumer downstream of storage keeps working
 *  untouched. These call the *real* app modules, not copies. */
describe("downstream consumers survive a round trip", () => {
  it("leaves blocksToText — the FTS index and word count — identical", async () => {
    const { blocksToText } = await import("@/lib/docFormat");
    const blocks = parse([
      "# Title",
      "Body with **bold** and a [link](https://example.com).",
      "- one\n- two\n  - nested",
      "> quoted",
      "```js\nconst a = 1;\n```",
    ].join("\n\n"));
    expect(blocksToText(roundTrip(blocks))).toBe(blocksToText(blocks));
  });

  it("keeps mermaid searchable, which blocksToText reads from props", async () => {
    const { blocksToText } = await import("@/lib/docFormat");
    const blocks: Block[] = [{ type: "mermaid", props: { code: "graph TD\n  A --> B" } }];
    expect(blocksToText(roundTrip(blocks))).toBe("graph TD\n  A --> B");
  });

  it("leaves the mermaid transforms working on both sides", async () => {
    const { liftMermaid, lowerMermaid } = await import("../mermaidTransforms");
    const blocks = parse("```mermaid\ngraph TD\n  A --> B\n```");
    // The transforms are still typed against BlockNote's PartialBlock; they
    // operate structurally, which is the point of keeping the format fixed.
    const lifted = liftMermaid(blocks as never);
    expect(lifted[0].type).toBe("mermaid");
    // Survives the editor and still lowers back to a portable code fence.
    const lowered = lowerMermaid(roundTrip(lifted as Block[]));
    expect(lowered[0].type).toBe("codeBlock");
    expect(lowered[0].props.language).toBe("mermaid");
  });

  it("leaves the YouTube transforms working on both sides", async () => {
    const { liftYouTube, lowerYouTube } = await import("../mediaTransforms");
    const lifted = liftYouTube(parse("[title](https://youtu.be/aR97E7aKEgg)"));
    expect(lifted[0].type).toBe("youtube");
    const survived = roundTrip(lifted as Block[]);
    expect(survived[0].props?.caption).toBe("title");
    expect(lowerYouTube(survived)[0].type).toBe("paragraph");
  });

  it("leaves DocumentOutline able to find headings", async () => {
    const blocks = parse("# One\n\ntext\n\n## Two");
    const headings = roundTrip(blocks).filter((block) => block.type === "heading");
    expect(headings.map((h) => h.props?.level)).toEqual([1, 2]);
  });
});

describe("edge cases", () => {
  it("turns an empty document into a single paragraph", () => {
    expect(blocksToPmDoc([]).content).toEqual([{ type: "paragraph" }]);
  });

  it("returns nothing for a missing doc", () => {
    expect(pmDocToBlocks(null)).toEqual([]);
  });

  it("drops empty text runs that ProseMirror cannot represent", () => {
    const blocks: Block[] = [{
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: "", styles: {} },
        { type: "text", text: "kept", styles: {} },
      ],
    }];
    const doc = blocksToPmDoc(blocks);
    expect((doc.content as any)[0].content).toEqual([{ type: "text", text: "kept" }]);
  });

  it("collapses adjacent runs sharing one href back into a single link", () => {
    const pm = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "bo", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://a.test" } }] },
          { type: "text", text: "ld", marks: [{ type: "link", attrs: { href: "https://a.test" } }] },
        ],
      }],
    };
    const [block] = pmDocToBlocks(pm as any);
    expect(block.content).toEqual([{
      type: "link",
      href: "https://a.test",
      content: [
        { type: "text", text: "bo", styles: { bold: true } },
        { type: "text", text: "ld", styles: {} },
      ],
    }]);
  });
});

/**
 * Block literals written by hand use a plain string where the parser emits an
 * inline array. `BlockTemplatesMenu` does it throughout.
 *
 * Iterating a string yields *characters*, none of which carry `.text`, so
 * without explicit handling every one is dropped and the block arrives empty —
 * which is what a "broken template" looks like from the outside.
 */
describe("plain-string content shorthand", () => {
  it("keeps the text of a string-content block", () => {
    const out = roundTrip([{ type: "paragraph", props: {}, content: "hello" } as Block]);
    expect(out[0].content).toEqual([{ type: "text", text: "hello", styles: {} }]);
  });

  it.each([
    ["heading", { type: "heading", props: { level: 2 }, content: "Term" }],
    ["quote", { type: "quote", props: {}, content: "Callout: the key idea" }],
    ["checkListItem", { type: "checkListItem", props: { checked: false }, content: "First task" }],
  ])("keeps the text of a string-content %s", (_label, block) => {
    const out = roundTrip([block as Block]);
    expect(JSON.stringify(out)).toContain((block as Block).content as string);
  });

  it("renders a real BlockTemplatesMenu template with its text intact", async () => {
    // The actual shapes the Templates menu inserts, not a stand-in.
    const template: Block[] = [
      { type: "heading", props: { level: 2 }, content: "Fix a bug — #0000" },
      { type: "paragraph", content: [
        { type: "text", text: "Status: ", styles: { bold: true } },
        { type: "text", text: "not started", styles: {} },
      ] },
      { type: "heading", props: { level: 3 }, content: "Pipeline" },
      { type: "checkListItem", props: { checked: false }, content: "Reproduced" },
      { type: "quote", content: "0000-00-00 · stage" },
    ];
    const { blocksToText } = await import("@/lib/docFormat");
    const text = blocksToText(roundTrip(template));
    for (const expected of ["Fix a bug", "Status:", "Pipeline", "Reproduced", "stage"]) {
      expect(text).toContain(expected);
    }
  });

  it("treats an empty string as no content rather than an empty text node", () => {
    // ProseMirror rejects a zero-length text node outright.
    const out = blocksToPmDoc([{ type: "paragraph", props: {}, content: "" } as Block]);
    expect((out.content as any)[0].content).toEqual([]);
  });
});
