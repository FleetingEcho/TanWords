import { describe, expect, it } from "vitest";
import { sanitizeRemoteHtml } from "./sanitizeHtml";

describe("sanitizeRemoteHtml", () => {
  it("strips scripts and event handlers but keeps the text", () => {
    expect(sanitizeRemoteHtml('<p>hello <script>alert(1)</script>world</p>')).toBe(
      "<p>hello world</p>",
    );
    expect(sanitizeRemoteHtml('<img src="x" onerror="alert(1)">after')).toBe("after");
  });

  it("keeps allowed inline markup from real HN comments", () => {
    // The HTML parser itself won't nest <pre> inside <p> (it closes the
    // paragraph first) — the sanitizer's own HN fixture respects that instead
    // of pretending the shape is reachable.
    expect(
      sanitizeRemoteHtml('<p>one<i>two</i></p><pre><code>three()</code></pre><p>four</p>'),
    ).toBe("<p>one<i>two</i></p><pre><code>three()</code></pre><p>four</p>");
  });

  it("forces links open externally and drops unsafe hrefs", () => {
    expect(sanitizeRemoteHtml('<a href="https://example.com/x">ok</a>')).toBe(
      '<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">ok</a>',
    );
    expect(sanitizeRemoteHtml('<a href="javascript:alert(1)">nope</a>')).toBe("nope");
    expect(sanitizeRemoteHtml('<a href="file:///etc/passwd">nope</a>')).toBe("nope");
  });

  it("unwraps unknown tags without losing their content", () => {
    expect(sanitizeRemoteHtml('<div class="x"><span>a</span> b</div>')).toBe("a b");
  });

  it("removes non-element nodes such as comments", () => {
    expect(sanitizeRemoteHtml("a<!-- sneaky -->b")).toBe("ab");
  });
});
