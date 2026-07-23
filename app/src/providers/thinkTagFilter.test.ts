import { describe, it, expect } from "vitest";
import { ThinkTagFilter } from "./thinkTagFilter";

/** Feeds `chunks` through the filter one at a time, exactly like a streamed
 * SSE response would, and returns the concatenated sanitized output. */
function run(chunks: string[]): string {
  const f = new ThinkTagFilter();
  let out = "";
  for (const c of chunks) out += f.push(c);
  out += f.flush();
  return out;
}

describe("ThinkTagFilter", () => {
  it("passes plain content through untouched", () => {
    expect(run(["Hello, ", "world."])).toBe("Hello, world.");
  });

  it("strips a leading <think>...</think> block delivered as one chunk", () => {
    expect(run(["<think>reasoning about it</think>The answer is 42."])).toBe("The answer is 42.");
  });

  it("strips a think block split across many small chunks, mid-tag", () => {
    const full = "<think>internal monologue</think>Final answer.";
    const chunks = full.split("").map((c) => c); // one character per chunk
    expect(run(chunks)).toBe("Final answer.");
  });

  it("handles the opening tag itself split across chunk boundaries", () => {
    expect(run(["<thi", "nk>hidden</thi", "nk>visible"])).toBe("visible");
  });

  it("is case-insensitive", () => {
    expect(run(["<THINK>hidden</THINK>visible"])).toBe("visible");
  });

  it("strips multiple separate think blocks", () => {
    expect(run(["<think>a</think>keep1<think>b</think>keep2"])).toBe("keep1keep2");
  });

  it("drops an unterminated trailing think block instead of leaking it", () => {
    expect(run(["before<think>never closes"])).toBe("before");
  });

  it("doesn't hold back plain text that merely ends near a tag-like prefix", () => {
    // "<th" alone should eventually flush if it never becomes "<think>".
    expect(run(["price is < th", "reshold value"])).toBe("price is < threshold value");
  });
});
