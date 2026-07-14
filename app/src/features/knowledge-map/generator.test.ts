import { describe, expect, it } from "vitest";
import { DEFAULT_BRANCHES } from "./generator";

describe("knowledge map default branches", () => {
  it("always includes a dedicated situational sentence branch", () => {
    expect(DEFAULT_BRANCHES).toContainEqual(expect.objectContaining({
      kind: "category",
      label: "Common Situational Sentences",
    }));
  });
});
