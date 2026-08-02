import { describe, it, expect } from "vitest";
import { cleanPastedText, isReadableText, markdownToPlainText, isSupportedTextFile } from "./pastedText";

describe("cleanPastedText", () => {
  it("rejoins hard-wrapped lines into one paragraph", () => {
    const pdf = [
      "The query planner considers several strategies before",
      "settling on one, and the cost model is what decides",
      "between them.",
    ].join("\n");
    expect(cleanPastedText(pdf)).toBe(
      "The query planner considers several strategies before settling on one, and the cost model is what decides between them."
    );
  });

  it("repairs words hyphenated across a line break", () => {
    expect(cleanPastedText("an inter-\nnational standard")).toBe("an international standard");
  });

  it("keeps a hyphen when the next line starts a new word", () => {
    expect(cleanPastedText("the well-\nKnown Ltd case")).toContain("well-Known Ltd");
  });

  it("keeps paragraph breaks and drops page-number lines", () => {
    const src = "First paragraph here.\n\n12\n\nSecond paragraph here.";
    expect(cleanPastedText(src)).toBe("First paragraph here.\n\nSecond paragraph here.");
    expect(cleanPastedText("Body text.\n\nPage 3 of 12\n\nMore body.")).toBe("Body text.\n\nMore body.");
  });

  it("keeps list items on their own lines", () => {
    const src = "Reasons:\n- first reason\n- second reason";
    expect(cleanPastedText(src)).toBe("Reasons:\n- first reason\n- second reason");
  });

  it("strips non-breaking spaces, zero-width and control characters", () => {
    const dirty = "smart quotes​ and control";
    expect(cleanPastedText(dirty)).toBe("smart quotes and control");
  });

  it("is idempotent", () => {
    const src = "A wrapped line that\nkeeps going.\n\nAnd another.";
    const once = cleanPastedText(src);
    expect(cleanPastedText(once)).toBe(once);
  });
});

describe("isReadableText", () => {
  it("accepts ordinary prose", () => {
    expect(isReadableText("The query planner considers several strategies before choosing one.")).toBe(true);
  });

  it("rejects base64 and data URLs", () => {
    expect(isReadableText("data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUg".repeat(20))).toBe(false);
  });

  it("rejects too-short or symbol-heavy pastes", () => {
    expect(isReadableText("ok")).toBe(false);
    expect(isReadableText("{{{ }}} <<< >>> ||| ??? *** ### @@@ %%% ^^^ &&&")).toBe(false);
  });
});

describe("markdownToPlainText", () => {
  it("strips headings, emphasis, links and images", () => {
    const md = "# Title\n\nSome **bold** and *italic* with a [link](https://x.com) and ![img](a.png).";
    const out = markdownToPlainText(md);
    expect(out).toContain("Title");
    expect(out).toContain("Some bold and italic with a link and .");
    expect(out).not.toMatch(/[#*\[\]]/);
  });

  it("keeps code content but drops the fences and inline backticks", () => {
    const out = markdownToPlainText("```ts\nconst a = 1;\n```\nUse `npm run dev` to start.");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("Use npm run dev to start.");
    expect(out).not.toContain("```");
  });

  it("drops front matter and table rules, and normalizes bullets", () => {
    const out = markdownToPlainText("---\ntitle: x\n---\n- one\n- two\n\n| a | b |\n| --- | --- |");
    expect(out).not.toContain("title: x");
    expect(out).toContain("· one");
    expect(out).not.toContain("---");
  });
});

describe("isSupportedTextFile", () => {
  it("accepts txt and markdown, rejects everything else", () => {
    expect(isSupportedTextFile("notes.md")).toBe(true);
    expect(isSupportedTextFile("Article.TXT")).toBe(true);
    expect(isSupportedTextFile("paper.pdf")).toBe(false);
    expect(isSupportedTextFile("deck.pptx")).toBe(false);
  });
});
