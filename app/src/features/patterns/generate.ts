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
    for await (const c of provider.generate(system, user)) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      chunks.push(c);
      const now = Date.now();
      if (onChunk && now - lastEmit > 300) { lastEmit = now; onChunk(chunks.join("")); }
    }
    return chunks.join("");
  })();
  let timer: number | undefined;
  const timeout = new Promise<string>((_, reject) => { timer = window.setTimeout(() => reject(new Error("模型生成超时")), 60000); });
  try { return await Promise.race([run, timeout]); } finally { if (timer) window.clearTimeout(timer); }
}

const SYSTEM_PROMPT =
  "You are an expert English coach for Chinese learners. You produce natural, high-value example sentences people genuinely say — not stiff textbook prose. Vary register (formal/casual), sense, and grammatical role; calibrate to the learner's CEFR level with some stretch one level above. Chinese translations must be natural and idiomatic. Return ONLY a JSON array in the exact requested format — no markdown fences, no commentary.";

export async function generateSentences(provider: AIProvider, query: string, targetLevels: string, exclude: string[] = [], signal?: AbortSignal, onPartial?: (items: GeneratedSentence[]) => void): Promise<GeneratedSentence[]> {
  const user = [
    `Word or topic: ${query}`,
    `Learner level: CEFR ${targetLevels || "B1/B2"}.`,
    `Generate 15 natural English sentences using or about it, each built on a reusable sentence pattern worth learning. Cover different senses, collocations, registers and scenarios — no two sentences should share the same pattern.`,
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
