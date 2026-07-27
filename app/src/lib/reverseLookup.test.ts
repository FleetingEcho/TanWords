import { describe, it, expect } from "vitest";
import { parseReverseLookup } from "./reverseLookup";

const FULL = `[
  {"en":"hesitate","word_type":"v","level":"B1","zh":"犹豫","note":"最通用，指动作上的停顿","example":"She hesitated before answering.","example_zh":"她回答前犹豫了一下。"},
  {"en":"waver","word_type":"v","level":"C1","zh":"动摇","note":"指立场或决心不坚定","example":"He never wavered.","example_zh":"他从未动摇。"}
]`;

describe("parseReverseLookup", () => {
  it("parses a complete response", () => {
    const out = parseReverseLookup(FULL);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ en: "hesitate", wordType: "v", level: "B1", zh: "犹豫", exampleZh: "她回答前犹豫了一下。" });
  });

  it("tolerates a chatty preamble and code fence", () => {
    expect(parseReverseLookup('好的：\n```json\n' + FULL)[0].en).toBe("hesitate");
  });

  it("parses a truncated mid-stream response", () => {
    const out = parseReverseLookup(FULL.slice(0, 160));
    expect(out[0].en).toBe("hesitate");
  });

  it("drops entries without an English word, and caps at 4", () => {
    expect(parseReverseLookup('[{"zh":"犹豫"},{"en":"  "}]')).toEqual([]);
    expect(parseReverseLookup(JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ en: `w${i}` }))))).toHaveLength(4);
  });

  it("returns [] for a non-array or unparsable response", () => {
    expect(parseReverseLookup("抱歉，我无法理解")).toEqual([]);
    expect(parseReverseLookup('{"en":"hesitate"}')).toEqual([]);
  });

  it("ignores an invalid CEFR level instead of passing it through", () => {
    expect(parseReverseLookup('[{"en":"waver","level":"X9"}]')[0].level).toBeUndefined();
  });
});
