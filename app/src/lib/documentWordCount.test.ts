import { describe, expect, it } from "vitest";
import { countDocumentWords } from "./documentWordCount";

describe("countDocumentWords", () => {
  it("counts whitespace-separated Latin words", () => {
    expect(countDocumentWords("one two\nthree")).toBe(3);
  });

  it("counts CJK characters instead of treating a paragraph as one word", () => {
    expect(countDocumentWords("你好世界")).toBe(4);
    expect(countDocumentWords("中文 without 空格")).toBe(5);
  });

  it("does not count punctuation or symbols as words", () => {
    expect(countDocumentWords("你好，world! ... —")).toBe(3);
  });
});
