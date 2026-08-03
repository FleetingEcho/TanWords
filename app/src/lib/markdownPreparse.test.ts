import { describe, it, expect } from "vitest";
import { repairMarkdown } from "./markdownPreparse";

describe("repairMarkdown", () => {
  it("gives an empty-label link its URL as the label", () => {
    expect(repairMarkdown("[](https://example.com/a)")).toBe("[https://example.com/a](https://example.com/a)");
  });

  it("keeps a title attribute", () => {
    expect(repairMarkdown('[](https://example.com "Docs")')).toBe(
      '[https://example.com](https://example.com "Docs")',
    );
  });

  it("unwraps an angle-bracketed target for the label but not the target", () => {
    expect(repairMarkdown("[](<https://example.com/a b>)")).toBe("[https://example.com/a b](<https://example.com/a b>)");
  });

  it("leaves a link that already has a label alone", () => {
    const md = "[docs](https://example.com)";
    expect(repairMarkdown(md)).toBe(md);
  });

  it("leaves an empty target alone — there is nothing to recover", () => {
    expect(repairMarkdown("[]()")).toBe("[]()");
  });

  it("repairs every occurrence, not just the first", () => {
    expect(repairMarkdown("[](https://a.test) and [](https://b.test)")).toBe(
      "[https://a.test](https://a.test) and [https://b.test](https://b.test)",
    );
  });
});
