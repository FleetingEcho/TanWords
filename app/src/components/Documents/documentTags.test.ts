import { describe, expect, it } from "vitest";
import { addTag, parseTags } from "./documentTags";

describe("parseTags", () => {
  it("reads a well-formed tag array", () => {
    expect(parseTags('["work","bug"]')).toEqual(["work", "bug"]);
  });

  it("survives what an MCP client might have written", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("not json")).toEqual([]);
    expect(parseTags('{"tags":["work"]}')).toEqual([]);
    expect(parseTags('["work",7,null,"bug"]')).toEqual(["work", "bug"]);
  });
});

describe("addTag", () => {
  it("appends a trimmed tag", () => {
    expect(addTag(["work"], "  bug  ")).toEqual(["work", "bug"]);
  });

  it("collapses inner whitespace", () => {
    expect(addTag([], "code   review")).toEqual(["code review"]);
  });

  it("ignores blank input", () => {
    const existing = ["work"];
    expect(addTag(existing, "   ")).toBe(existing);
  });

  it("treats case as insignificant and keeps the copy already present", () => {
    const existing = ["Work"];
    expect(addTag(existing, "work")).toBe(existing);
  });

  it("clamps a tag to 32 characters", () => {
    expect(addTag([], "x".repeat(50))).toEqual(["x".repeat(32)]);
  });
});
