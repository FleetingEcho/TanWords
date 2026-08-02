import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts common article HTML without DOM", () => {
    const md = htmlToMarkdown(`
      <h2><a href="https://example.com/post">Open Models</a></h2>
      <p>Hello <strong>world</strong> &amp; <em>friends</em>.</p>
      <ul><li>one</li><li>two</li></ul>
      <blockquote>quote</blockquote>
      <pre><code>const x = 1;</code></pre>
    `);
    expect(md).toContain("## [Open Models](https://example.com/post)");
    expect(md).toContain("**world**");
    expect(md).toContain("&");
    expect(md).toContain("- one");
    expect(md).toContain("> quote");
    expect(md).toContain("```");
  });

  it("drops scripts and styles", () => {
    const md = htmlToMarkdown(`<script>alert(1)</script><style>p{color:red}</style><p>kept</p>`);
    expect(md).toBe("kept");
  });
});
