import { describe, expect, it } from "vitest";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { filterSentencePatterns } from "./sentenceSearch";

const patterns: PatternItem[] = [
  {
    id: 1,
    pattern: "may + verb",
    zh: "可能",
    note: "表达可能性",
    level: "B1",
    starred: false,
    created_at: "",
    updated_at: "",
    examples: [{ id: 1, sentence: "The company may announce the results tomorrow.", source: "manual" }],
  },
  {
    id: 2,
    pattern: "be responsible for",
    zh: "负责",
    note: "",
    level: "B1",
    starred: false,
    created_at: "",
    updated_at: "",
    examples: [{ id: 2, sentence: "She is responsible for hiring.", source: "manual" }],
  },
];

describe("filterSentencePatterns", () => {
  it("finds a keyword inside saved example sentences", () => {
    expect(filterSentencePatterns(patterns, "company").map((item) => item.id)).toEqual([1]);
  });

  it("reliably matches multiple keywords regardless of spacing or case", () => {
    expect(filterSentencePatterns(patterns, "  COMPANY   Tomorrow ").map((item) => item.id)).toEqual([1]);
  });

  it("searches translations, notes, and pattern skeletons too", () => {
    expect(filterSentencePatterns(patterns, "可能").map((item) => item.id)).toEqual([1]);
    expect(filterSentencePatterns(patterns, "responsible").map((item) => item.id)).toEqual([2]);
  });
});
