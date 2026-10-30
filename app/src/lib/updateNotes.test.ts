import { describe, expect, it } from "vitest";
import { normalizeUpdateNotes } from "./updateNotes";

describe("normalizeUpdateNotes", () => {
  it("keeps plain text and Markdown intact", () => {
    expect(normalizeUpdateNotes("## Changes\n\n- Faster startup")).toBe(
      "## Changes\n\n- Faster startup",
    );
  });

  it("turns malformed nested HTML into safe multiline text", () => {
    expect(normalizeUpdateNotes(
      "<div><h1>Highlights</h1><div>Fixed &amp; improved<div><script>alert('bad')</script>",
    )).toBe("Highlights\nFixed & improved");
  });

  it("decodes entity-escaped feed HTML before removing its tags", () => {
    expect(normalizeUpdateNotes(
      "&lt;h2&gt;Better notes&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;First fix&lt;/li&gt;&lt;/ul&gt;",
    )).toBe("Better notes\n• First fix");
  });

  it("preserves list structure and line breaks", () => {
    expect(normalizeUpdateNotes("<h2>Fixes</h2><ul><li>One</li><li>Two<br>continued</li></ul>"))
      .toBe("Fixes\n• One\n• Two\ncontinued");
  });
});
