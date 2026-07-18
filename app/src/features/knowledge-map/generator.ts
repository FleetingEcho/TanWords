import { jsonrepair } from "jsonrepair";
import type { AIProvider } from "@/providers/base";
import type { NewKnowledgeNode } from "./types";

export type RootType = "word" | "topic";
export type InputKind = "word" | "topic" | "sentence";

/** Heuristic routing for the universal input box: full sentences go to
 * instant analysis, everything else becomes an expandable topic. */
export function classifyInput(raw: string): InputKind {
  const input = raw.trim();
  if (/[。！？.!?]$/.test(input) || input.split(/\s+/).length >= 5) return "sentence";
  if (!/[\s，,]/.test(input)) return "word";
  return "topic";
}

export interface SectionDef {
  key: string;
  label: string;
  zh: string;
  itemKind: "word" | "phrase";
  /** Instruction sentence spliced into the generation prompt. */
  instruction: string;
  count: string;
}

const TOPIC_SECTIONS: SectionDef[] = [
  { key: "core", label: "Core Vocabulary", zh: "核心词汇", itemKind: "word", count: "10-14",
    instruction: "the essential words a learner must know for this topic: concrete nouns, key verbs, and important adjectives. Cover the topic broadly, from everyday basics up to precise C1 terms. Note field: part of speech abbreviation only (n. / v. / adj. / adv.)." },
  { key: "collocations", label: "Collocations", zh: "高频搭配", itemKind: "phrase", count: "8-10",
    instruction: "high-frequency collocations and fixed phrases native speakers actually use for this topic (verb+noun, adjective+noun, prepositional phrases). Note field: one short natural example sentence using the collocation." },
  { key: "sentences", label: "Practical Sentences", zh: "实用句式", itemKind: "phrase", count: "6-8",
    instruction: "complete, natural English sentences a person would really say in this situation — the reusable sentence patterns, not textbook examples. Note field: a one-line explanation of the sentence pattern and when to use it, in Chinese." },
  { key: "situations", label: "Scenario Lines", zh: "场景对话", itemKind: "phrase", count: "5-6",
    instruction: "short dialogue lines from typical scenarios within this topic (questions people ask, responses they give). Note field: who says it and in which scenario, in Chinese." },
  { key: "contrasts", label: "Confusables", zh: "易混辨析", itemKind: "word", count: "4-6",
    instruction: "pairs or small groups of easily confused words relevant to this topic. Label field: the confusable words joined with ' vs '. Note field: a concise Chinese explanation of the difference with a tiny example for each." },
];

const WORD_SECTIONS: SectionDef[] = [
  { key: "related", label: "Synonyms & Related", zh: "近义与关联词", itemKind: "word", count: "8-12",
    instruction: "synonyms, near-synonyms and closely related words, spanning register (formal/informal) and nuance. Note field: one short Chinese phrase pinning down the nuance vs the root word." },
  { key: "collocations", label: "Collocations", zh: "高频搭配", itemKind: "phrase", count: "8-10",
    instruction: "the collocations and fixed phrases this word most frequently appears in. Note field: one short natural example sentence." },
  { key: "sentences", label: "Example Sentences", zh: "地道例句", itemKind: "phrase", count: "5-6",
    instruction: "natural example sentences using this word in different senses and registers. Note field: a one-line Chinese note on which sense/register the sentence shows." },
  { key: "contrasts", label: "Confusables", zh: "易混辨析", itemKind: "word", count: "3-5",
    instruction: "words easily confused with this one. Label field: the confusable words joined with ' vs '. Note field: a concise Chinese explanation of the difference with a tiny example for each." },
];

export const SECTION_PRESETS: Record<RootType, SectionDef[]> = { topic: TOPIC_SECTIONS, word: WORD_SECTIONS };

export const DEEP_DIVE_SECTION = (label: string): SectionDef => ({
  key: "deep", label, zh: "", itemKind: "word", count: "8-12",
  instruction: "a focused deep-dive: the most useful words, phrases and one or two full sentences for this sub-topic. Mix kinds as appropriate. Note field: part of speech for words, a short Chinese usage note for phrases and sentences.",
});

const SYSTEM_PROMPT =
  "You are an expert English vocabulary coach for Chinese learners. You expand a topic into practical, high-value language: words and expressions people genuinely use, calibrated to the learner's CEFR level with some stretch items one level above. Prefer concrete, immediately usable items over rare or academic ones. Chinese glosses must be short, natural, and idiomatic. Return ONLY a JSON array in the exact requested format — no markdown fences, no commentary.";

export function parseItems(raw: string, defaultKind: "word" | "phrase"): NewKnowledgeNode[] {
  const start = raw.indexOf("[");
  if (start < 0) return [];
  try {
    const data = JSON.parse(jsonrepair(raw.slice(start)));
    if (!Array.isArray(data)) return [];
    return data.map((x: any): NewKnowledgeNode => Array.isArray(x)
      ? { label: String(x[0] ?? ""), zh: String(x[1] ?? ""), level: String(x[2] ?? "").toUpperCase(), kind: String(x[3] ?? "") === "phrase" ? "phrase" : String(x[3] ?? "") === "word" ? "word" : defaultKind, note: String(x[4] ?? "") }
      : { label: String(x.label ?? x.word ?? ""), zh: String(x.zh ?? ""), level: String(x.level ?? "").toUpperCase(), kind: x.kind === "phrase" || x.kind === "word" ? x.kind : defaultKind, note: String(x.note ?? x.example ?? "") })
      .filter((x) => x.label.trim())
      .slice(0, 16);
  } catch { return []; }
}

async function collect(provider: AIProvider, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const run = (async () => {
    const chunks: string[] = [];
    for await (const c of provider.generate(system, user)) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      chunks.push(c);
    }
    return chunks.join("");
  })();
  let timer: number | undefined;
  const timeout = new Promise<string>((_, reject) => { timer = window.setTimeout(() => reject(new Error("模型生成超时")), 60000); });
  try { return await Promise.race([run, timeout]); } finally { if (timer) window.clearTimeout(timer); }
}

export async function generateSection(provider: AIProvider, topic: string, section: SectionDef, targetLevels: string, exclude: string[] = [], signal?: AbortSignal): Promise<NewKnowledgeNode[]> {
  const user = [
    `Topic: ${topic}`,
    `Learner level: CEFR ${targetLevels || "B1/B2"}.`,
    `Generate ${section.count} items for the section "${section.label}" (${section.zh}): ${section.instruction}`,
    exclude.length ? `Do NOT repeat any of: ${exclude.slice(0, 120).join(", ")}.` : "",
    `Format — a JSON array of 5-element arrays: [["English item","简短中文释义","A2|B1|B2|C1|C2","word|phrase","note per the section rules"]]. For full sentences use kind "phrase" and put the natural Chinese translation in the second field.`,
  ].filter(Boolean).join("\n");
  return parseItems(await collect(provider, SYSTEM_PROMPT, user, signal), section.itemKind);
}

/** Sub-topic suggestions for the "dig deeper" card. Returns [label, zh] pairs. */
export async function suggestSubtopics(provider: AIProvider, topic: string, covered: string[], signal?: AbortSignal): Promise<Array<[string, string]>> {
  const system = "You suggest focused sub-topics an English learner could expand next. Return ONLY a JSON array, no commentary.";
  const user = `Topic: ${topic}\nAlready covered sections: ${covered.join(", ")}.\nSuggest 4 specific, practical sub-topics worth a vocabulary deep-dive. Format: [["sub-topic in English","简短中文"]]. Keep each under 4 words.`;
  try {
    const raw = await collect(provider, system, user, signal);
    const start = raw.indexOf("[");
    if (start < 0) return [];
    const data = JSON.parse(jsonrepair(raw.slice(start)));
    return (Array.isArray(data) ? data : [])
      .map((x: any): [string, string] => Array.isArray(x) ? [String(x[0] ?? ""), String(x[1] ?? "")] : [String(x?.label ?? ""), String(x?.zh ?? "")])
      .filter(([label]) => label.trim())
      .slice(0, 4);
  } catch { return []; }
}

export interface SentenceAnalysis {
  translation: string;
  pattern: string;
  /** Reusable English pattern skeleton, e.g. "be shortlisted for + noun". */
  skeleton: string;
  items: NewKnowledgeNode[];
  related: string[];
}

export async function analyzeSentence(provider: AIProvider, sentence: string, targetLevels: string, signal?: AbortSignal): Promise<SentenceAnalysis> {
  const system = "You are an expert English coach for Chinese learners. You break a sentence down into learnable pieces. Return ONLY one JSON object, no markdown fences, no commentary.";
  const user = [
    `Sentence: ${sentence}`,
    `Learner level: CEFR ${targetLevels || "B1/B2"}.`,
    `Return a JSON object with exactly these keys:`,
    `"translation": natural Chinese translation of the sentence.`,
    `"pattern": one-line Chinese explanation of the key sentence pattern / grammar point, quoting the English pattern (e.g. "be shortlisted for + n. → 被动语态表\\"入围\\"").`,
    `"skeleton": the reusable English pattern skeleton on its own, e.g. "be shortlisted for + noun".`,
    `"items": the words and collocations in the sentence worth learning at this level, as an array of 5-element arrays [["word or phrase","简短中文释义","A2|B1|B2|C1|C2","word|phrase","短注释：词性或用法"]]. Skip trivial words below the learner's level.`,
    `"related": 2-3 short English topic suggestions to explore next, as an array of strings.`,
  ].join("\n");
  const raw = await collect(provider, system, user, signal);
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("模型未返回有效分析");
  const data = JSON.parse(jsonrepair(raw.slice(start)));
  return {
    translation: String(data.translation ?? ""),
    pattern: String(data.pattern ?? ""),
    skeleton: String(data.skeleton ?? ""),
    items: parseItems(JSON.stringify(data.items ?? []), "word"),
    related: (Array.isArray(data.related) ? data.related : []).map((x: any) => String(x)).filter(Boolean).slice(0, 3),
  };
}
