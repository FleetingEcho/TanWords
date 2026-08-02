import { jsonrepair } from "jsonrepair";
import {
  AIProvider, CEFRLevel, SENTENCE_PATTERN_SYSTEM_PROMPT, buildSentencePatternUserPrompt,
} from "@/providers/base";

const VALID_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface SentencePatternInfo {
  zh: string;
  skeleton: string;
  note: string;
  level: string;
}

export function parseSentencePattern(raw: string): SentencePatternInfo | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    const data = JSON.parse(jsonrepair(raw.slice(start)));
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const levelRaw = str(data.level).toUpperCase();
    const zh = str(data.zh);
    if (!zh) return null; // a pattern with no translation isn't worth saving
    return {
      zh,
      skeleton: str(data.skeleton),
      note: str(data.note),
      level: VALID_LEVELS.find((l) => l === levelRaw) ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Analyses one sentence into the fields the pattern library needs
 * (translation, reusable skeleton, usage note, level). Used when the learner
 * selects a sentence inside a chat reply and saves it — the model wrote that
 * sentence as prose, so none of this metadata exists yet.
 * Never throws: returns null on any failure and the caller falls back to
 * saving the bare sentence.
 */
export async function fetchSentencePattern(
  provider: AIProvider,
  sentence: string,
  targetLevel: string,
  signal?: AbortSignal
): Promise<SentencePatternInfo | null> {
  const run = (async () => {
    let raw = "";
    for await (const chunk of provider.generate(
      SENTENCE_PATTERN_SYSTEM_PROMPT,
      buildSentencePatternUserPrompt(sentence, targetLevel),
      signal
    )) {
      if (signal?.aborted) return "";
      raw += chunk;
    }
    return raw;
  })();
  // If the timeout wins, `run` is orphaned — swallow a late rejection.
  run.catch(() => {});
  const timeout = new Promise<string>((resolve) => { window.setTimeout(() => resolve(""), 20000); });
  try {
    return parseSentencePattern(await Promise.race([run, timeout]));
  } catch {
    return null;
  }
}
