import { describe, expect, it } from "vitest";
import type { SentenceItem } from "@/hooks/useDB.sentences";
import { filterSentencePatterns } from "./sentenceSearch";

const sentences: SentenceItem[] = [
  {
    id: 1,
    sentence: "The company may announce the results tomorrow.",
    zh: "可能",
    note: "表达可能性",
    level: "B1",
    source: "manual",
    article_id: null,
    starred: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: 2,
    sentence: "She is responsible for hiring.",
    zh: "负责",
    note: "",
    level: "B1",
    source: "manual",
    article_id: null,
    starred: false,
    created_at: "",
    updated_at: "",
  },
];

describe("filterSentencePatterns", () => {
  it("finds a keyword inside saved sentences", () => {
    expect(filterSentencePatterns(sentences, "company").map((item) => item.id)).toEqual([1]);
  });

  it("reliably matches multiple keywords regardless of spacing or case", () => {
    expect(filterSentencePatterns(sentences, "  COMPANY   Tomorrow ").map((item) => item.id)).toEqual([1]);
  });

  it("searches translations and notes too", () => {
    expect(filterSentencePatterns(sentences, "可能").map((item) => item.id)).toEqual([1]);
    expect(filterSentencePatterns(sentences, "responsible").map((item) => item.id)).toEqual([2]);
  });
});
