import { describe, it, expect, beforeEach } from "vitest";
import {
  SENTENCE_FILTER_STORAGE_KEY,
  DEFAULT_SENTENCE_FILTERS,
  loadSentenceFilters,
  persistSentenceFilters,
} from "./sentenceFilterDefs";

describe("sentenceFilterDefs persistence", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults on empty storage", () => {
    expect(loadSentenceFilters()).toEqual(DEFAULT_SENTENCE_FILTERS);
  });

  it("round-trips a full working set; search/dates are not stored", () => {
    persistSentenceFilters({ levels: ["C1", "B1-"], starredOnly: true, source: "chat", sortBy: "alpha", sortDesc: false });
    expect(loadSentenceFilters()).toEqual({ levels: ["C1", "B1-"], starredOnly: true, source: "chat", sortBy: "alpha", sortDesc: false });
  });

  it("sanitizes an unknown level / oversized source / bad sort", () => {
    localStorage.setItem(
      SENTENCE_FILTER_STORAGE_KEY,
      JSON.stringify({ levels: ["C1", "ZZ"], source: "x".repeat(200), sortBy: "bogus", sortDesc: "yes" })
    );
    const loaded = loadSentenceFilters();
    expect(loaded.levels).toEqual(["C1"]);
    expect(loaded.source).toBe("all");
    expect(loaded.sortBy).toBe("recent");
    expect(loaded.sortDesc).toBe(true); // non-false boolean-ish degrades to true
  });

  it("corrupt JSON degrades to defaults instead of throwing", () => {
    localStorage.setItem(SENTENCE_FILTER_STORAGE_KEY, "{not json");
    expect(loadSentenceFilters()).toEqual(DEFAULT_SENTENCE_FILTERS);
  });

  it("a partially-filled old payload fills the rest with defaults", () => {
    localStorage.setItem(SENTENCE_FILTER_STORAGE_KEY, JSON.stringify({ starredOnly: true }));
    expect(loadSentenceFilters()).toEqual({ ...DEFAULT_SENTENCE_FILTERS, starredOnly: true });
  });
});
