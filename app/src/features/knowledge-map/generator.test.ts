import { describe, expect, it } from "vitest";
import type { AIProvider } from "@/providers/base";
import { BRANCH_PRESETS, generateBranch, isSentenceBranchLabel } from "./generator";

describe("knowledge map branch presets", () => {
  it("gives topic and situation maps a dedicated situational sentence branch", () => {
    expect(BRANCH_PRESETS.topic).toContainEqual(expect.objectContaining({
      kind: "category",
      label: "Common Situational Sentences",
    }));
    expect(BRANCH_PRESETS.situation).toContainEqual(expect.objectContaining({
      kind: "category",
      label: "Common Situational Sentences",
    }));
  });

  it("gives single-word maps a lean, word-focused branch set that still covers scene sentences", () => {
    expect(BRANCH_PRESETS.word).toHaveLength(5);
    expect(BRANCH_PRESETS.word).toContainEqual(expect.objectContaining({
      kind: "category",
      label: "Example Sentences",
    }));
    expect(BRANCH_PRESETS.word).toContainEqual(expect.objectContaining({
      kind: "category",
      label: "Common Situational Sentences",
    }));
    expect(BRANCH_PRESETS.word.some((branch) => branch.label === "Situations & Use Cases")).toBe(false);
  });

  it("recognizes both sentence-branch labels used across presets", () => {
    expect(isSentenceBranchLabel("Common Situational Sentences")).toBe(true);
    expect(isSentenceBranchLabel("Example Sentences")).toBe(true);
    expect(isSentenceBranchLabel("Core Vocabulary")).toBe(false);
  });

  it("fills a weak model response to five bilingual sentences", async () => {
    const provider = {
      async *generate() {
        yield '[["Is it going to rain?","会下雨吗？","A2","phrase",""]]';
      },
    } as unknown as AIProvider;
    const branch = BRANCH_PRESETS.situation.find((item) => item.label === "Common Situational Sentences")!;

    const result = await generateBranch(provider, "两个人在外面讨论天气", branch, "A2/B1");

    expect(result).toHaveLength(5);
    expect(result.every((item) => item.kind === "phrase" && item.label && item.zh)).toBe(true);
  });
});
