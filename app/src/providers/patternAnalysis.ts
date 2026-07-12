/**
 * Streaming AI helpers for sentence-pattern learning (句式学习).
 *
 * Thin prompt wrappers over `provider.chat()` — they stream markdown that the
 * UI renders directly (and stores as-is in `patterns.analysis`), so there is
 * no JSON parsing to break mid-stream.
 */

import { findBestProvider } from "@/providers/select";
import type { PatternTag } from "@/hooks/useDB.types";

export const PATTERN_TAGS: PatternTag[] = [
  "contrast", "concession", "emphasis", "causal", "condition", "comparison", "example", "other",
];

const SENTENCE_SYSTEM = `你是一位面向 C1 水平中国学习者的英语精读老师。用户给你一个来自真实文章的英文句子,请用中文按下面的结构分析,直接输出 markdown,不要开场白:

## 主干
一句话点出主语/谓语/宾语的核心结构(关键成分用英文原词)。

## 层次
若有从句、插入语、分词结构,逐层拆开说明各自修饰什么;简单句则说明为什么简单却有效。

## 亮点表达
1-3 个值得积累的用词或搭配,各给一句为什么地道。

## 句式骨架
若句中有可迁移的句式,严格按以下三行格式输出(供程序解析,可变槽位用 X/Y 表示):
骨架:not so much X as Y
含义:与其说是X,不如说是Y
例句:一个 C1 水平的新例句
没有可迁移句式时只输出一行:骨架:无

## 改写
用更平实的英文改写这句话,让学习者对照体会原句的表达选择。`;

const PATTERN_SYSTEM = `你是一位面向 C1 水平中国学习者的英语写作老师。用户给你一个从真实文章中收集的英文句式(可能附带原始例句),请分析它。

第一行必须严格输出(供程序解析,tag 从 contrast/concession/emphasis/causal/condition/comparison/example/other 中选一个):
TAG: <tag>

然后空一行,用中文输出 markdown,不要开场白:

## 结构拆解
标注句式的各个成分(固定部分用英文原词,可变槽位用 X/Y 表示),说明各成分的语法角色。

## 语用功能
这个句式在什么语境下用、达到什么修辞效果、正式度如何。

## 常见变体
2-3 个近似句式或语序变体,各一句话说明差别。

## 例句
写 3 个 C1-C2 水平、题材各异的新例句(科技/社会/个人叙事),每句附中文大意。

## 易错点
中国学习者使用这个句式最容易犯的 1-2 个错误。`;

function requireProvider() {
  const provider = findBestProvider();
  if (!provider) throw new Error("未配置 AI Provider — 请先在设置中填写 API Key");
  return provider;
}

/** 精读:流式分析文章中的一个句子。 */
export async function* analyzeSentence(
  sentence: string,
  articleTitle?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const provider = requireProvider();
  const context = articleTitle ? `(出自文章《${articleTitle}》)\n\n` : "";
  yield* provider.chat(
    [{ role: "user", content: `${context}${sentence}` }],
    SENTENCE_SYSTEM,
    signal
  );
}

/** 句式库:流式深度分析一个句式(含 TAG 首行,用 splitPatternAnalysis 解析)。 */
export async function* analyzePattern(
  pattern: string,
  zh: string,
  examples: string[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const provider = requireProvider();
  const exampleBlock = examples.length
    ? `\n\n真实例句:\n${examples.map((e) => `- ${e}`).join("\n")}`
    : "";
  yield* provider.chat(
    [{ role: "user", content: `句式:${pattern}\n含义:${zh}${exampleBlock}` }],
    PATTERN_SYSTEM,
    signal
  );
}

/** 从句子精读结果中解析「句式骨架」段;无可迁移句式或解析失败返回 null。 */
export function extractSentencePattern(markdown: string): { pattern: string; zh: string } | null {
  const skeleton = markdown.match(/骨架[::]\s*(.+)/)?.[1]?.trim();
  if (!skeleton || skeleton === "无" || skeleton.startsWith("无明显")) return null;
  const zh = markdown.match(/含义[::]\s*(.+)/)?.[1]?.trim() ?? "";
  return { pattern: skeleton.replace(/^["“]|["”]$/g, ""), zh };
}

/** 从完整的句式分析文本中剥离首行 TAG,返回 { tag, body }。 */
export function splitPatternAnalysis(full: string): { tag: PatternTag; body: string } {
  const match = full.match(/^\s*TAG:\s*(\w+)\s*\n?/);
  const raw = (match?.[1] ?? "other").toLowerCase() as PatternTag;
  const tag = PATTERN_TAGS.includes(raw) ? raw : "other";
  const body = match ? full.slice(match[0].length).trimStart() : full;
  return { tag, body };
}

// ── Production Practice (造句练习) ───────────────────────────────────────────

const PRACTICE_SYSTEM = `你是一位面向 C1 水平中国学习者的英语写作老师。学生尝试用一个句式写了自己的句子,请你评判并给出反馈。

第一行必须严格输出(供程序解析,以下三种之一):
VERDICT: good
VERDICT: okay
VERDICT: wrong

然后空一行,用中文输出 markdown,不要开场白:

## 判定
一句话说明句子是否正确使用了该句式(结构上套对了吗),好在哪里或问题在哪。

## 语言问题
语法/搭配/用词方面的具体问题,逐条指出并给出修正(没有问题就说"没有语言问题")。

## 更地道的写法
给出 1 个升级版句子(保持原意,C1-C2 水平),说明改动了什么。

## 一句话建议
给出下次使用该句式时可以注意的一个要点。`;

export type PracticeVerdict = "good" | "okay" | "wrong";

/** 造句练习:流式评判用户用指定句式造的句子。 */
export async function* gradePracticeSentence(
  pattern: string,
  zh: string,
  userSentence: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const provider = requireProvider();
  yield* provider.chat(
    [
      {
        role: "user",
        content: `句式:${pattern}\n含义:${zh}\n学生句子:${userSentence}`,
      },
    ],
    PRACTICE_SYSTEM,
    signal
  );
}

/** 从完整的造句评判文本中剥离首行 VERDICT,返回 { verdict, body }。 */
export function splitPracticeFeedback(full: string): {
  verdict: PracticeVerdict;
  body: string;
} {
  const match = full.match(/^\s*VERDICT:\s*(good|okay|wrong)\s*\n?/i);
  const raw = (match?.[1] ?? "okay").toLowerCase() as PracticeVerdict;
  const verdict: PracticeVerdict =
    raw === "good" ? "good" : raw === "wrong" ? "wrong" : "okay";
  const body = match ? full.slice(match[0].length).trimStart() : full;
  return { verdict, body };
}
