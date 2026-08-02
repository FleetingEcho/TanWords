import { describe, expect, it } from "vitest";
import { findTextMatches } from "./documentSearch";

describe("findTextMatches large-document bounds", () => {
  it("stops creating live DOM ranges at the requested limit", () => {
    const root = document.createElement("div");
    root.textContent = "x".repeat(10_000);

    expect(findTextMatches(root, "x", 1_000)).toHaveLength(1_000);
  });
});
