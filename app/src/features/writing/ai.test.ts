import { describe, expect, it } from "vitest";
import { filterSuggestedVocabulary } from "./vocabulary";

describe("filterSuggestedVocabulary", () => {
  it("keeps only B1+ suggestions and normalizes their level", () => {
    const result = filterSuggestedVocabulary([
      { word: "substantial", level: "B2", meaning: "大量的", reason: "", exampleSentence: "It made a substantial difference." },
      { word: "useful", meaning: "有用的", reason: "", exampleSentence: "It is useful." },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ word: "substantial", level: "B2" });
  });

  it("rejects elementary vocabulary even when the model mislabels it", () => {
    const result = filterSuggestedVocabulary([
      { word: "hi", level: "B2", meaning: "你好", reason: "", exampleSentence: "Hi there." },
    ]);
    expect(result).toEqual([]);
  });
});
