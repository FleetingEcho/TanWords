import { describe, it, expect } from "vitest";
import { DisplayItem, estimateTokens, trimItemsToBudget, buildApiHistory, buildPresetPrompt, unwrapMarkdownFence } from "./aiChatHelpers";

const user = (content: string): DisplayItem => ({ kind: "message", msg: { role: "user", content } });
const ai = (content: string): DisplayItem => ({ kind: "message", msg: { role: "assistant", content } });
const toolBlock = (input: unknown, result = "ok"): DisplayItem => ({
  kind: "tool_block",
  calls: [{ id: "t1", name: "extract_vocabulary", input: input as Record<string, unknown>, result, status: "done" }],
});

describe("estimateTokens", () => {
  it("counts tool call input and results, not just message text", () => {
    const withTool = [user("hi"), ai(""), toolBlock({ items: ["a".repeat(400)] })];
    expect(estimateTokens(withTool)).toBeGreaterThan(estimateTokens([user("hi"), ai("")]) + 100);
  });
});

describe("unwrapMarkdownFence", () => {
  it("unwraps a whole markdown fence from local-model output", () => {
    expect(unwrapMarkdownFence("```markdown\n## 标题\n\n内容\n```")).toBe("## 标题\n\n内容");
  });

  it("preserves ordinary markdown and inner code fences", () => {
    const text = "说明\n\n```ts\nconst n = 1;\n```";
    expect(unwrapMarkdownFence(text)).toBe(text);
  });
});

describe("reading tutor prompt", () => {
  it("requires a vocabulary section with at least 20 items", () => {
    const prompt = buildPresetPrompt("reading-tutor", "B2");
    expect(prompt).toContain("## 值得学的词汇");
    expect(prompt).toContain("AT LEAST 20");
    expect(prompt).toContain("Never omit this section");
  });
});

describe("trimItemsToBudget", () => {
  const convo = [
    user("first question"), ai("first answer"),
    user("second question"), ai("second answer"),
    user("third question"), ai("third answer"),
  ];

  it("keeps everything when it already fits", () => {
    const { items, droppedTurns } = trimItemsToBudget(convo, 10_000);
    expect(droppedTurns).toBe(0);
    expect(items).toHaveLength(6);
  });

  it("drops whole turns from the front, always starting on a user message", () => {
    const { items, droppedTurns } = trimItemsToBudget(convo, 30);
    expect(droppedTurns).toBeGreaterThan(0);
    expect(items[0]).toEqual(expect.objectContaining({ kind: "message" }));
    expect((items[0] as { msg: { role: string } }).msg.role).toBe("user");
    expect(items[items.length - 1]).toEqual(convo[convo.length - 1]);
  });

  it("never strands a tool_block from the turn that produced it", () => {
    const withTools = [
      user("q1"), ai("thinking"), toolBlock({ items: ["x".repeat(500)] }), ai("a1"),
      user("q2"), ai("a2"),
    ];
    const { items } = trimItemsToBudget(withTools, 50);
    // A surviving tool_block must still be preceded by its assistant message,
    // otherwise buildApiHistory emits a tool_result with no matching tool_use.
    items.forEach((item, i) => {
      if (item.kind === "tool_block") {
        expect(items[i - 1]?.kind).toBe("message");
        expect((items[i - 1] as { msg: { role: string } }).msg.role).toBe("assistant");
      }
    });
    const history = buildApiHistory(items);
    const toolUseIds = history.flatMap((m) =>
      Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id) : []
    );
    const toolResultIds = history.flatMap((m) =>
      Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id) : []
    );
    expect(toolResultIds.sort()).toEqual(toolUseIds.sort());
  });

  it("keeps the most recent turn even if it alone blows the budget", () => {
    const huge = [user("old"), ai("old answer"), user("x".repeat(5000))];
    const { items } = trimItemsToBudget(huge, 10);
    expect(items).toHaveLength(1);
    expect((items[0] as { msg: { content: string } }).msg.content).toHaveLength(5000);
  });
});
