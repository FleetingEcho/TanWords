import { jsonrepair } from "jsonrepair";
import { AIProvider, CEFRLevel, BASIC_INFO_SYSTEM_PROMPT, buildBasicInfoUserPrompt } from "@/providers/base";

const VALID_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface BasicInfo {
  wordType?: string;
  level?: string;
  zh?: string;
}

export function parseBasicInfo(raw: string): BasicInfo {
  const start = raw.indexOf("{");
  if (start < 0) return {};
  try {
    const data = JSON.parse(jsonrepair(raw.slice(start)));
    const levelRaw = typeof data.level === "string" ? data.level.trim().toUpperCase() : "";
    const level = VALID_LEVELS.find((l) => l === levelRaw);
    const wordType = typeof data.word_type === "string" ? data.word_type.trim() : "";
    const zh = typeof data.zh === "string" ? data.zh.trim() : "";
    return { wordType: wordType || undefined, level, zh: zh || undefined };
  } catch {
    return {};
  }
}

/**
 * Fetches a word's authoritative basic info (part of speech, CEFR level,
 * one-line Chinese gloss) via a small structured-JSON call — kept separate
 * from the free-form `enrich` explanation so the word list's word_type/
 * level/gloss are never at the mercy of a model that garbles or skips an
 * embedded metadata line in the middle of a long prose stream.
 * Never throws — callers get `{}` on any failure (no provider, timeout,
 * unparsable response) and just fall back to whatever they already have.
 */
export async function fetchBasicInfo(
  provider: AIProvider,
  word: string,
  targetLevel: string,
  signal?: AbortSignal
): Promise<BasicInfo> {
  const run = (async () => {
    let raw = "";
    for await (const chunk of provider.generate(BASIC_INFO_SYSTEM_PROMPT, buildBasicInfoUserPrompt(word, targetLevel), signal)) {
      if (signal?.aborted) return "";
      raw += chunk;
    }
    return raw;
  })();
  // If the timeout wins, `run` is orphaned — swallow a late rejection.
  run.catch(() => {});
  const timeout = new Promise<string>((resolve) => { window.setTimeout(() => resolve(""), 20000); });
  try {
    const raw = await Promise.race([run, timeout]);
    return parseBasicInfo(raw);
  } catch {
    return {};
  }
}
