import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/client", () => ({ invoke: invokeMock }));

import { executeTool } from "./tools";

function call(name: string, input: Record<string, unknown> = {}) {
  return executeTool({ id: "t1", name, input });
}

describe("vocabulary AI tools", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns the saved word count", async () => {
    invokeMock.mockResolvedValue(42);

    const result = await call("get_vocabulary_stats");

    expect(invokeMock).toHaveBeenCalledWith("db_get_word_count");
    expect(result.content).toContain("42");
    expect(result.content).toContain("words");
  });

  it("lists a page of words with meaning, level, and SRS metadata", async () => {
    invokeMock.mockResolvedValue([
      { word: "serendipity", zh: "意外发现", level: "C1", srs_level: 3 },
      { word: "hedge", zh: "对冲", level: "B2", srs_level: 0 },
    ]);

    const result = await call("list_vocabulary", { limit: 1, sortBy: "alpha" });

    expect(invokeMock).toHaveBeenCalledWith(
      "db_get_words",
      expect.objectContaining({ search: null, levelFilter: null, sortBy: "alpha" })
    );
    expect(result.content).toContain("Vocabulary has 2 words");
    expect(result.content).toContain("serendipity");
    expect(result.content).toContain("意外发现");
  });

  it("reports an empty vocabulary", async () => {
    invokeMock.mockResolvedValue([]);

    const result = await call("list_vocabulary");

    expect(result.content).toBe("No vocabulary words found.");
  });

  it("saves generated sentences to the sentence library", async () => {
    invokeMock
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });

    const result = await call("save_sentences", {
      sentences: [
        { sentence: "It was not until later that the pattern became clear.", zh: "直到后来这个规律才清晰起来." },
        { sentence: "The plan hinges on timing.", zh: "这个计划取决于时机." },
      ],
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "db_save_sentence_pattern", expect.objectContaining({
      sentence: "It was not until later that the pattern became clear.",
      source: "chat",
    }));
    expect(result.content).toContain("Saved 1 sentence");
    expect(result.content).toContain("skipped 1");
  });
});
