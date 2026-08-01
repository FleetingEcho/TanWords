/**
 * Article analysis & extraction — port of the desktop reading pipeline.
 *
 * What desktop does (app/src/hooks/useAnalyzeArticle.ts): stream a markdown
 * study note (文章大意 / 值得学习的词汇 / 亮点句子 / 亮点句型 / 地道表达),
 * display it in a notes pane, and persist `content + analysis_markdown` to
 * the `articles` table (app/core/src/db/articles.rs). Vocabulary/pattern
 * extraction → accept flow exists separately, as AiChat tool calls
 * (app/src/components/AiChat/tools.ts: extract_vocabulary / extract_patterns
 * + VocabExtractionCard / SentenceExtractionCard).
 *
 * What the mobile reading tab needs is ONE pass that produces the accept
 * flow's structured lists directly, so the user goes paste → 提取 →
 * 勾选 → 加入 without a chat in the middle. This module therefore uses the
 * extract_* tool schemas' item fields (word/zh/word_type/level/context;
 * sentence/zh/skeleton/note/level), requested as a single streamed JSON
 * document, and keeps the desktop's exclusion semantics verbatim
 * (user_known_words ∪ vocabulary words, lowercased, first 150 in the prompt).
 *
 * Simplifications vs desktop (documented in the task's final report):
 *  - No markdown study note and no `articles` table write — accept-flow only.
 *    TODO(M4): if the AI Chat notes pane gets ported, reuse useAnalyzeArticle's
 *    original prompts + db_save_article_analysis for parity.
 *  - No HN comments second pass (buildCommentsPrompt) — the reading tab has
 *    no comments source on mobile; HN lives in the Feeds area.
 */
import { jsonrepair } from "jsonrepair";
import type { AIProvider } from "@/providers/base";
import { db_get_words } from "@/db/words";
import { db_get_known_words } from "@/db/knownWords";

/** System prompt copied VERBATIM from desktop useAnalyzeArticle.ts —
 *  the tutor persona is unchanged even though the user prompt asks for JSON. */
export const ANALYZE_SYSTEM_PROMPT = `You are an English reading tutor for a Chinese native speaker. Create practical, substantial study notes grounded in the source text. Output ONLY markdown — no commentary about the task itself and no code fences around the whole response. Do not mention or classify content by CEFR or any other proficiency framework.`;

export function buildExtractionPrompt(text: string, knownWords: string[]): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `Read the article below and extract study material for a vocabulary-notebook accept flow.

Return ONLY one JSON object (no markdown fences, no commentary):
{
  "words": [
    { "word": "<base/dictionary form>", "zh": "<concise Chinese meaning in this context>", "word_type": "n|v|adj|adv|prep|phrase|idiom", "level": "A1|A2|B1|B2|C1|C2", "context": "<the sentence from the article where it appears>" }
  ],
  "patterns": [
    { "sentence": "<the EXACT complete sentence, copied verbatim>", "zh": "<natural Chinese translation>", "skeleton": "<reusable pattern with replaceable parts in brackets>", "note": "<short Chinese note: 这句好在哪、用了什么句式/语法/修辞>", "level": "A2|B1|B2|C1|C2" }
  ]
}

Rules:
- Select 20-30 words or short phrases worth learning — collocations, phrasal verbs, idioms, and familiar words used in unfamiliar senses, not just rare words. Prefer broadly useful English over proper nouns, product names, and basic technical terms.
- Select 4-8 sentences worth imitating because they are clear, elegant, persuasive, or reusable. Copy them verbatim; never invent or silently rewrite a quote.
- skeleton must capture the transferable structure (e.g. "It is not until X that Y"), not restate the whole sentence, and not degenerate to "subject + verb".
- The user already knows these words; do not include them in words: ${known || "(none listed)"}
- Write each JSON item on its own line so partial results can be read while streaming.
- Do not include CEFR levels anywhere except the "level" field values themselves.
- If the text is too short or unsuitable to extract from, return {"words": [], "patterns": []}.

Article:
"""
${text}
"""`;
}

/** One extracted word row (mirrors extract_vocabulary's item schema). */
export interface ExtractedWord {
  word: string;
  zh: string;
  word_type: string;
  level: string;
  context: string;
}

/** One extracted pattern row (mirrors extract_patterns' item schema). */
export interface ExtractedPattern {
  sentence: string;
  zh: string;
  skeleton: string;
  note: string;
  level: string;
}

export interface ExtractionResult {
  words: ExtractedWord[];
  patterns: ExtractedPattern[];
}

const VALID_WORD_TYPES = new Set(["n", "v", "adj", "adv", "prep", "phrase", "idiom"]);
const VALID_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function sanitizeWord(raw: Record<string, unknown>): ExtractedWord | null {
  const word = str(raw.word);
  const zh = str(raw.zh);
  if (!word || !zh) return null; // a wordless/glossless row is never worth accepting
  const wt = str(raw.word_type).toLowerCase();
  const lv = str(raw.level).toUpperCase();
  return {
    word,
    zh,
    word_type: VALID_WORD_TYPES.has(wt) ? wt : "",
    level: VALID_LEVELS.has(lv) ? lv : "",
    context: str(raw.context),
  };
}

function sanitizePattern(raw: Record<string, unknown>): ExtractedPattern | null {
  const sentence = str(raw.sentence);
  const zh = str(raw.zh);
  if (!sentence || !zh) return null;
  const lv = str(raw.level).toUpperCase();
  return {
    sentence,
    zh,
    skeleton: str(raw.skeleton),
    note: str(raw.note),
    level: VALID_LEVELS.has(lv) ? lv : "",
  };
}

function sanitizeExtraction(data: Record<string, unknown>): ExtractionResult {
  const wordsRaw = Array.isArray(data.words) ? (data.words as Record<string, unknown>[]) : [];
  const patternsRaw = Array.isArray(data.patterns) ? (data.patterns as Record<string, unknown>[]) : [];
  // Dedupe by word/sentence — models occasionally repeat rows.
  const seenW = new Set<string>();
  const seenP = new Set<string>();
  const words: ExtractedWord[] = [];
  const patterns: ExtractedPattern[] = [];
  for (const w of wordsRaw) {
    const item = sanitizeWord(w);
    if (!item) continue;
    const key = item.word.toLowerCase();
    if (seenW.has(key)) continue;
    seenW.add(key);
    words.push(item);
  }
  for (const p of patternsRaw) {
    const item = sanitizePattern(p);
    if (!item) continue;
    if (seenP.has(item.sentence)) continue;
    seenP.add(item.sentence);
    patterns.push(item);
  }
  return { words, patterns };
}

/** Full-document parse of the model's final answer, tolerant of fences /
 *  leading prose / truncated JSON (jsonrepair, same recovery the desktop
 *  uses in lib/patternFromSentence.ts). */
export function parseExtraction(raw: string): ExtractionResult {
  const start = raw.indexOf("{");
  if (start < 0) return { words: [], patterns: [] };
  try {
    const data = JSON.parse(jsonrepair(raw.slice(start))) as Record<string, unknown>;
    if (data && typeof data === "object") return sanitizeExtraction(data);
  } catch {
    // fall through to the line scanner — a truncated stream can still be
    // salvaged per completed line.
  }
  return parseExtractionStream(raw, () => {});
}

/**
 * Incremental line scanner for the streaming path. The prompt asks the model
 * to write each item on its own line, so a completed line ending in ',' is a
 * complete JSON object we can show progress for. Never throws, creates no
 * partial state — `onItem` fires once per unique item.
 */
export function parseExtractionStream(
  buffer: string,
  onItem: (kind: "word" | "pattern") => void
): ExtractionResult {
  const words: ExtractedWord[] = [];
  const patterns: ExtractedPattern[] = [];
  let section: "none" | "words" | "patterns" = "none";
  let inWords = false;
  let inPatterns = false;
  const seenW = new Set<string>();
  const seenP = new Set<string>();

  for (const lineRaw of buffer.split("\n")) {
    const head = lineRaw.slice(0, 24);
    if (head.includes('"words"')) {
      inWords = true;
      section = "words";
      continue;
    }
    if (head.includes('"patterns"')) {
      inPatterns = true;
      section = "patterns";
      continue;
    }
    if (section === "none") continue;

    // A line that opens an item object — grab from its first '{' to the
    // end, strip the trailing comma, and let jsonrepair close braces/quotes
    // on a mid-stream line.
    const braceIdx = lineRaw.indexOf("{");
    if (braceIdx < 0) continue;
    let candidate = lineRaw.slice(braceIdx).trim();
    if (!candidate.endsWith("}") && !candidate.endsWith(",")) {
      // Not a complete-looking object line yet — skip until it grows into one.
      if (!inWords && !inPatterns) continue;
    }
    if (candidate.endsWith(",")) candidate = candidate.slice(0, -1);
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(jsonrepair(candidate)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (section === "words") {
      const item = sanitizeWord(obj);
      if (!item) continue;
      const key = item.word.toLowerCase();
      if (seenW.has(key)) continue;
      seenW.add(key);
      words.push(item);
      onItem("word");
    } else if (section === "patterns") {
      const item = sanitizePattern(obj);
      if (!item) continue;
      if (seenP.has(item.sentence)) continue;
      seenP.add(item.sentence);
      patterns.push(item);
      onItem("pattern");
    }
  }
  return { words, patterns };
}

/**
 * The word-exclusion list the desktop builds before every analysis:
 * user-known words ∪ vocabulary words, lowercased
 * (useAnalyzeArticle.ts: db.getKnownWords() + db.getWords()).
 */
export async function loadExcludedWords(): Promise<string[]> {
  const [knownWords, vocab] = await Promise.all([db_get_known_words(), db_get_words()]);
  return [
    ...new Set([
      ...knownWords.map((w) => w.toLowerCase()),
      ...vocab.map((w) => w.word.toLowerCase()),
    ]),
  ];
}

export interface StreamExtractionEvents {
  /** Incremental parse progress — counts keep the waiting card honest. */
  onItem?: (counts: { words: number; patterns: number }) => void;
  /** Raw character progress (total streamed), same basis as desktop's. */
  onChars?: (received: number) => void;
}

/** Stream the extraction JSON from the provider, parsing incrementally. */
export async function streamExtraction(
  provider: AIProvider,
  text: string,
  excludedWords: string[],
  signal: AbortSignal,
  events?: StreamExtractionEvents
): Promise<ExtractionResult> {
  let received = 0;
  let buffer = "";
  let lastCounts = { words: 0, patterns: 0 };
  for await (const chunk of provider.generate(
    ANALYZE_SYSTEM_PROMPT,
    buildExtractionPrompt(text, excludedWords),
    signal
  )) {
    if (signal.aborted) break;
    buffer += chunk;
    received += chunk.length;
    events?.onChars?.(received);
    const counts = { words: 0, patterns: 0 };
    parseExtractionStream(buffer, (kind) => {
      if (kind === "word") counts.words += 1;
      else counts.patterns += 1;
    });
    if (counts.words !== lastCounts.words || counts.patterns !== lastCounts.patterns) {
      lastCounts = counts;
      events?.onItem?.(lastCounts);
    }
  }
  if (signal.aborted) {
    throw abortedError();
  }
  // Final authoritative parse of the whole buffer — the incremental pass is
  // best-effort progress only and must not decide what the user can accept.
  return parseExtraction(buffer);
}

export function abortedError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** Desktop (useAnalyzeArticle.ts) normalizes browser fetch failures to a
 *  friendly Chinese message; RN fetch throws "Network request failed"
 *  instead of "Failed to fetch" — same fix, platform-adjusted. */
export function normalizeAnalyzeError(e: unknown): Error {
  if (e instanceof Error) {
    if (
      e.message === "Load failed" ||
      e.message === "Failed to fetch" ||
      e.message === "Network request failed"
    ) {
      return new Error("网络请求失败。请检查 API Key 与网络连接");
    }
    return e;
  }
  return new Error(String(e));
}
