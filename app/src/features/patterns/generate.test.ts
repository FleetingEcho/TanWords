import { describe, expect, it } from "vitest";
import { parseGeneratedSentences } from "./generate";

describe("parseGeneratedSentences", () => {
  it("parses tuple arrays", () => {
    const raw = 'ok [["She was shortlisted for the role.","她入围了这个职位。","C1","be shortlisted for + noun","正式，招聘场景"]]';
    const items = parseGeneratedSentences(raw);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sentence: "She was shortlisted for the role.", zh: "她入围了这个职位。", level: "C1", skeleton: "be shortlisted for + noun" });
  });
  it("drops entries missing sentence or translation and repairs malformed JSON", () => {
    const items = parseGeneratedSentences('[["Good sentence.","好句子。","B1","x","n",],["","没句子","B1","",""],["No zh.","","B1","",""]]');
    expect(items).toHaveLength(1);
    expect(items[0].sentence).toBe("Good sentence.");
  });
  it("returns empty for non-array output", () => {
    expect(parseGeneratedSentences("cannot help with that")).toEqual([]);
  });
});
