import { describe, expect, it } from "vitest";
import type { AIProvider } from "@/providers/base";
import { DEFAULT_BRANCHES, generateBranch } from "./generator";

describe("knowledge map default branches", () => {
  it("always includes a dedicated situational sentence branch", () => {
    expect(DEFAULT_BRANCHES).toContainEqual(expect.objectContaining({
      kind: "category",
      label: "Common Situational Sentences",
    }));
  });

  it("fills a weak model response to five bilingual sentences", async () => {
    const provider = {
      async *generate() {
        yield '[["Is it going to rain?","会下雨吗？","A2","phrase",""]]';
      },
    } as unknown as AIProvider;
    const branch = DEFAULT_BRANCHES.find((item) => item.label === "Common Situational Sentences")!;

    const result = await generateBranch(provider, "两个人在外面讨论天气", branch, "A2/B1");

    expect(result).toHaveLength(5);
    expect(result.every((item) => item.kind === "phrase" && item.label && item.zh)).toBe(true);
  });
});
