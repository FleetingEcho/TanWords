import { describe, it, expect } from "vitest";
import { parseEnrichOutline } from "./enrichSections";

const ATX = `“Simmer” 这个词的核心意象非常生动。

### 1. 核心释义与物理场景：烹饪中的“微沸”

指液体加热到接近沸点但不剧烈沸腾。

> Bring the sauce to a boil, then simmer for 20 minutes.
> 将酱汁煮沸，然后小火慢炖 20 分钟。

#### 一个更细的分类

深一级的标题留在正文里。

### 易混淆点：Simmer vs. Boil

- **Boil** 是剧烈的沸腾。`;

describe("parseEnrichOutline", () => {
  it("splits on ATX headings and keeps the text before the first one as the lead", () => {
    const { lead, sections } = parseEnrichOutline(ATX);
    expect(lead).toBe("“Simmer” 这个词的核心意象非常生动。");
    expect(sections.map((s) => s.title)).toEqual([
      "1. 核心释义与物理场景：烹饪中的“微沸”",
      "易混淆点：Simmer vs. Boil",
    ]);
  });

  it("only splits on the shallowest heading level, leaving deeper ones in the body", () => {
    const { sections } = parseEnrichOutline(ATX);
    expect(sections).toHaveLength(2);
    expect(sections[0].body).toContain("#### 一个更细的分类");
  });

  it("reduces headings to chip labels: no ordinals, no markdown, no subtitle", () => {
    expect(parseEnrichOutline(ATX).sections.map((s) => s.label)).toEqual([
      "核心释义与物理场景",
      "易混淆点",
    ]);
    expect(parseEnrichOutline("## **常见搭配** `collocations`\n正文").sections[0].label).toBe("常见搭配 collocations");
  });

  it("keeps the whole heading as the label when the part before the colon is too short", () => {
    expect(parseEnrichOutline("## 1：核心释义\n正文").sections[0].label).toBe("1：核心释义");
  });

  it("falls back to standalone bold lines when the model emits no ATX headings", () => {
    const { lead, sections } = parseEnrichOutline("开头一句。\n\n**常见搭配：**\n\n- simmer down\n\n**记忆方法**\n\n想成一口锅。");
    expect(lead).toBe("开头一句。");
    expect(sections.map((s) => s.label)).toEqual(["常见搭配", "记忆方法"]);
  });

  it("treats bold lines as emphasis, not headings, once the document uses ATX", () => {
    const { sections } = parseEnrichOutline("## 释义\n\n**这是强调，不是标题**\n\n正文。");
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain("**这是强调，不是标题**");
  });

  it("ignores headings inside a fenced code block", () => {
    const { sections } = parseEnrichOutline("## 释义\n\n```md\n## 这在代码块里\n```\n\n正文。");
    expect(sections).toHaveLength(1);
  });

  it("handles a partially streamed document: no headings yet, then a trailing one", () => {
    expect(parseEnrichOutline("正在生成中，还没有标题").sections).toEqual([]);
    const trailing = parseEnrichOutline("开头。\n\n### 常见搭配");
    expect(trailing.sections).toHaveLength(1);
    expect(trailing.sections[0].body).toBe("");
  });

  it("gives sections ids that stay put as more of the stream arrives", () => {
    const partial = parseEnrichOutline("### 释义\n正文");
    const full = parseEnrichOutline("### 释义\n正文\n\n### 搭配\n正文");
    expect(full.sections[0].id).toBe(partial.sections[0].id);
    expect(full.sections[1].id).not.toBe(full.sections[0].id);
  });
});
