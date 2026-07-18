import { describe, expect, it } from "vitest";
import { classifyInput, parseItems } from "./generator";

describe("classifyInput", () => {
  it("routes single tokens to word", () => {
    expect(classifyInput("shortlist")).toBe("word");
    expect(classifyInput("  bank ")).toBe("word");
  });
  it("routes short multi-word inputs to topic", () => {
    expect(classifyInput("job interview")).toBe("topic");
    expect(classifyInput("distributed systems design")).toBe("topic");
  });
  it("routes full sentences to sentence", () => {
    expect(classifyInput("He was shortlisted for the final round.")).toBe("sentence");
    expect(classifyInput("What do you think about it?")).toBe("sentence");
    expect(classifyInput("I really want to learn more about cooking today")).toBe("sentence");
  });
});

describe("parseItems", () => {
  it("parses tuple arrays and applies the default kind", () => {
    const raw = 'noise before [["land a job offer","拿到offer","B2","phrase","She landed a job offer."],["candidate","候选人","B1","word","n."]]';
    const items = parseItems(raw, "word");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ label: "land a job offer", zh: "拿到offer", level: "B2", kind: "phrase" });
    expect(items[1]).toMatchObject({ label: "candidate", kind: "word", note: "n." });
  });
  it("falls back to the default kind for unknown kinds", () => {
    const items = parseItems('[["résumé","简历","B1","sentence",""]]', "phrase");
    expect(items[0].kind).toBe("phrase");
  });
  it("repairs slightly malformed JSON and drops empty labels", () => {
    const items = parseItems('[["walk me through","请介绍一下","B2","phrase","note",],["","x","B1","word",""]]', "word");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("walk me through");
  });
  it("returns empty for output without an array", () => {
    expect(parseItems("sorry, I cannot help", "word")).toEqual([]);
  });
});
