// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { htmlToMarkdown, hnCommentsToMarkdown, buildArticleMarkdown } from "./articleMarkdown";
import type { HnComment } from "./hnComments";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, emphasis and links", () => {
    const md = htmlToMarkdown(
      `<h2>Section</h2><p>Some <strong>bold</strong> and <em>italic</em> with a <a href="https://example.com">link</a>.</p>`
    );
    expect(md).toBe("## Section\n\nSome **bold** and *italic* with a [link](https://example.com).");
  });

  it("converts lists, blockquotes and code blocks", () => {
    const md = htmlToMarkdown(
      `<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><blockquote><p>quoted</p></blockquote><pre><code>x = 1</code></pre>`
    );
    expect(md).toBe("- one\n- two\n  - nested\n\n> quoted\n\n```\nx = 1\n```");
  });

  it("drops scripts and keeps text of unknown wrappers", () => {
    const md = htmlToMarkdown(`<div><script>evil()</script><p>kept</p></div>`);
    expect(md).toBe("kept");
  });
});

describe("hnCommentsToMarkdown", () => {
  it("nests replies under their parents with authors", () => {
    const comments: HnComment[] = [
      {
        id: 1, by: "alice", time: null, text: "<p>Top point</p>",
        children: [{ id: 2, by: "bob", time: null, text: "I <i>disagree</i>", children: [] }],
      },
    ];
    expect(hnCommentsToMarkdown(comments)).toBe("- **alice**: Top point\n  - **bob**: I *disagree*");
  });
});

describe("buildArticleMarkdown", () => {
  it("assembles title, meta, source, body and comments", () => {
    const md = buildArticleMarkdown({
      title: "Title",
      byline: "Jane",
      siteName: "Example",
      sourceUrl: "https://example.com/a",
      contentHtml: "<p>Body</p>",
      comments: [{ id: 1, by: "alice", time: null, text: "hi there", children: [] }],
    });
    expect(md).toBe(
      "# Title\n\n*Jane · Example*\n\nSource: https://example.com/a\n\nBody\n\n## Comments\n\n- **alice**: hi there"
    );
  });

  it("omits source and comments when absent", () => {
    const md = buildArticleMarkdown({
      title: "T", byline: null, siteName: null, contentHtml: "<p>Body</p>", comments: null,
    });
    expect(md).toBe("# T\n\nBody");
  });
});
