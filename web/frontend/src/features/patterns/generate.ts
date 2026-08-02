import { jsonrepair } from "jsonrepair";
import type { AIProvider } from "@/providers/base";

export interface GeneratedSentence {
  sentence: string;
  zh: string;
  level: string;
  skeleton: string;
  note: string;
}

export function parseGeneratedSentences(raw: string): GeneratedSentence[] {
  const start = raw.indexOf("[");
  if (start < 0) return [];
  try {
    const data = JSON.parse(jsonrepair(raw.slice(start)));
    if (!Array.isArray(data)) return [];
    return data.map((x: any): GeneratedSentence => Array.isArray(x)
      ? { sentence: String(x[0] ?? ""), zh: String(x[1] ?? ""), level: String(x[2] ?? "").toUpperCase(), skeleton: String(x[3] ?? ""), note: String(x[4] ?? "") }
      : { sentence: String(x.sentence ?? ""), zh: String(x.zh ?? ""), level: String(x.level ?? "").toUpperCase(), skeleton: String(x.skeleton ?? x.pattern ?? ""), note: String(x.note ?? "") })
      .filter((x) => x.sentence.trim() && x.zh.trim())
      .slice(0, 20);
  } catch { return []; }
}

async function collect(provider: AIProvider, system: string, user: string, signal?: AbortSignal, onChunk?: (accumulated: string) => void): Promise<string> {
  const run = (async () => {
    const chunks: string[] = [];
    let lastEmit = 0;
    // The signal must reach the provider: per-chunk `signal.aborted` checks
    // never fire if the model stalls without emitting, so the HTTP request
    // (and its token spend) would run to completion even after cancel.
    for await (const c of provider.generate(system, user, signal)) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      chunks.push(c);
      const now = Date.now();
      if (onChunk && now - lastEmit > 300) { lastEmit = now; onChunk(chunks.join("")); }
    }
    return chunks.join("");
  })();
  // When the timeout wins the race, `run` is orphaned — swallow a late
  // rejection so it can't surface as an unhandled promise rejection.
  run.catch(() => {});
  let timer: number | undefined;
  const timeout = new Promise<string>((_, reject) => { timer = window.setTimeout(() => reject(new Error("模型生成超时")), 60000); });
  try { return await Promise.race([run, timeout]); } finally { if (timer) window.clearTimeout(timer); }
}

const SYSTEM_PROMPT =
  "You are an expert English coach for Chinese learners. You produce natural, high-value example sentences people genuinely say — not stiff textbook prose. Vary register (formal/casual), sense, and grammatical role; calibrate to the learner's CEFR level with some stretch one level above. Chinese translations must be natural and idiomatic. Return ONLY a JSON array in the exact requested format — no markdown fences, no commentary.";

/** Sentences per generation. "+ More" in the sentence modal calls this again
 *  with the batch so far in `exclude`, so this is the step size, not a cap —
 *  a smaller batch returns sooner and lets the learner ask for more rather
 *  than facing a wall of candidates. */
const SENTENCE_BATCH_SIZE = 5;

export async function generateSentences(provider: AIProvider, query: string, targetLevels: string, exclude: string[] = [], signal?: AbortSignal, onPartial?: (items: GeneratedSentence[]) => void): Promise<GeneratedSentence[]> {
  const user = [
    `Word or topic: ${query}`,
    `Learner level: CEFR ${targetLevels || "B1/B2"}.`,
    `Generate ${SENTENCE_BATCH_SIZE} natural English sentences using or about it, each built on a reusable sentence pattern worth learning. Cover different senses, collocations, registers and scenarios — no two sentences should share the same pattern.`,
    exclude.length ? `Do NOT repeat or closely paraphrase any of these sentences: ${exclude.slice(0, 60).map((s) => `"${s}"`).join(", ")}.` : "",
    `Format — a JSON array of 5-element arrays: [["the English sentence","自然中文翻译","A2|B1|B2|C1|C2","reusable pattern skeleton, e.g. 'be shortlisted for + noun'","一行中文注释：句式的使用场景或语气"]].`,
  ].filter(Boolean).join("\n");
  const raw = await collect(provider, SYSTEM_PROMPT, user, signal, onPartial && ((accumulated) => {
    // Stream progress: surface only the fully-received items — the trailing
    // element is usually a half-written sentence jsonrepair closed early.
    onPartial(parseGeneratedSentences(accumulated).slice(0, -1));
  }));
  return parseGeneratedSentences(raw);
}

const ANALYZE_SYSTEM_PROMPT =
  "You are an expert English coach for Chinese learners. Given one sentence the learner already has, you analyze it — you do not rewrite, correct, or replace it. Return ONLY a JSON array with exactly one 5-element array in the exact requested format — no markdown fences, no commentary.";

/** Analyzes one user-supplied sentence (quick-add flow) instead of inventing
 *  new ones — same output shape as generateSentences so both feed the same
 *  save path, but the sentence itself is echoed back verbatim. */
export async function analyzeSentence(provider: AIProvider, sentence: string, targetLevels: string, signal?: AbortSignal): Promise<GeneratedSentence> {
  const user = [
    `Sentence: "${sentence}"`,
    `Learner level: CEFR ${targetLevels || "B1/B2"}.`,
    `Analyze this exact sentence — do not paraphrase or correct it. Identify the reusable sentence pattern it demonstrates.`,
    `Format — a JSON array containing exactly one 5-element array: [["${sentence.replace(/"/g, '\\"')}","自然中文翻译","A2|B1|B2|C1|C2","reusable pattern skeleton, e.g. 'be shortlisted for + noun'","一行中文注释：句式的使用场景或语气"]].`,
  ].join("\n");
  const raw = await collect(provider, ANALYZE_SYSTEM_PROMPT, user, signal);
  const [result] = parseGeneratedSentences(raw);
  // The model is instructed to echo the sentence verbatim, but never trust
  // that literally — always save what the learner actually typed.
  return result ? { ...result, sentence } : { sentence, zh: "", level: "", skeleton: "", note: "" };
}
