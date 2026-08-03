import { describe, it, expect } from "vitest";
import { formatMarkdown } from "./formatMarkdown";

describe("formatMarkdown", () => {
  it("collapses runs of blank lines to one", () => {
    expect(formatMarkdown("a\n\n\n\n\nb")).toBe("a\n\nb\n");
  });

  it("drops leading and trailing blank lines and ends with exactly one newline", () => {
    expect(formatMarkdown("\n\n\nhello\n\n\n")).toBe("hello\n");
  });

  it("strips trailing whitespace but keeps a two-space hard break", () => {
    expect(formatMarkdown("a   \nb\t\nc  \nd")).toBe("a  \nb\nc  \nd\n");
  });

  it("gives a heading its missing space and a blank line above", () => {
    expect(formatMarkdown("text\n#Title\nmore")).toBe("text\n\n# Title\n\nmore\n");
  });

  it("leaves a well-formed heading of any level exactly alone", () => {
    for (const level of ["#", "##", "###", "####", "#####", "######"]) {
      expect(formatMarkdown(`${level} Title`)).toBe(`${level} Title\n`);
    }
  });

  it("never grows a heading, however many times it is run", () => {
    // The bug this covers: `### x` backtracked to "two hashes, then text
    // starting with a hash", and each pass inserted another space-and-hash.
    let text = "## Alpha\n\nbody\n\n### Beta\n";
    for (let pass = 0; pass < 5; pass += 1) text = formatMarkdown(text);
    expect(text).toBe("## Alpha\n\nbody\n\n### Beta\n");
  });

  it("collapses extra space after the hashes without touching the hashes", () => {
    expect(formatMarkdown("##    Title")).toBe("## Title\n");
  });

  it("leaves a bare hash run as the empty heading it is", () => {
    expect(formatMarkdown("###")).toBe("###\n");
  });

  it("is not fooled by more hashes than a heading can have", () => {
    // Seven is not a heading in CommonMark; it must stay a paragraph.
    expect(formatMarkdown("####### seven")).toBe("####### seven\n");
  });

  it("does not put a blank line above a heading that starts the file", () => {
    expect(formatMarkdown("# Title\n\nbody")).toBe("# Title\n\nbody\n");
  });

  it("normalises bullet markers to -", () => {
    expect(formatMarkdown("* one\n+ two\n- three")).toBe("- one\n- two\n- three\n");
  });

  it("keeps nesting indentation when normalising bullets", () => {
    expect(formatMarkdown("* one\n  * nested\n* two")).toBe("- one\n  - nested\n- two\n");
  });

  it("renumbers an ordered list sequentially", () => {
    expect(formatMarkdown("1. a\n1. b\n1. c")).toBe("1. a\n2. b\n3. c\n");
  });

  it("keeps the number a list actually starts from", () => {
    expect(formatMarkdown("3. a\n9. b")).toBe("3. a\n4. b\n");
  });

  it("treats a blank line inside a loose list as part of the same list", () => {
    expect(formatMarkdown("1. a\n\n1. b")).toBe("1. a\n\n2. b\n");
  });

  it("starts a new run after a paragraph interrupts", () => {
    expect(formatMarkdown("1. a\n1. b\n\nparagraph\n\n1. x\n1. y")).toBe(
      "1. a\n2. b\n\nparagraph\n\n1. x\n2. y\n",
    );
  });

  it("normalises thematic breaks", () => {
    expect(formatMarkdown("a\n***\nb\n___\nc")).toBe("a\n\n---\n\nb\n\n---\n\nc\n");
  });

  it("leaves a fenced code block completely alone", () => {
    const source = "```js\nconst  a =  1;\n\n\n*  not a list\n#not a heading\n```";
    expect(formatMarkdown(source)).toBe("```js\nconst  a =  1;\n\n\n*  not a list\n#not a heading\n```\n");
  });

  it("closes only on a matching fence", () => {
    const source = "```\n~~~\nstill code\n```\ntext";
    expect(formatMarkdown(source)).toBe("```\n~~~\nstill code\n```\n\ntext\n");
  });

  it("is idempotent", () => {
    const messy = "#Title\n\n\n## Sub\n\n### Deeper\n\n* a\n* b\n\n1. x\n1. y\n\n***\n\ntail   \n\n\n";
    const once = formatMarkdown(messy);
    expect(formatMarkdown(once)).toBe(once);
  });

  it("returns empty for empty input", () => {
    expect(formatMarkdown("")).toBe("");
    expect(formatMarkdown("\n\n\n")).toBe("");
  });

  it("never loses a non-blank line", () => {
    const source = "# H\ntext\n- a\n1. b\n> quote\n| t | u |\n```\ncode\n```\ntail";
    const before = source.split("\n").filter((line) => line.trim()).length;
    const after = formatMarkdown(source).split("\n").filter((line) => line.trim()).length;
    expect(after).toBe(before);
  });
});
