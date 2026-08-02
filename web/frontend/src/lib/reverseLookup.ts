import { jsonrepair } from "jsonrepair";
import { AIProvider, CEFRLevel, REVERSE_LOOKUP_SYSTEM_PROMPT, buildReverseLookupUserPrompt } from "@/providers/base";

const VALID_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** One English candidate for a Chinese query. Only `en` is guaranteed — the
 * rest are whatever the model supplied (and, mid-stream, whatever has
 * arrived so far), so every field is optional. */
export interface ReverseCandidate {
  en: string;
  wordType?: string;
  level?: string;
  zh?: string;
  note?: string;
  example?: string;
  exampleZh?: string;
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
};

/**
 * Parses the JSON array of candidates, tolerating a still-streaming (and so
 * truncated) response: jsonrepair closes the dangling string/object/array,
 * which lets the UI render each card as it lands instead of waiting for the
 * whole response. Returns [] on anything unparsable — a half-arrived first
 * candidate simply shows up as nothing until it has a `en` field.
 */
export function parseReverseLookup(raw: string): ReverseCandidate[] {
  const start = raw.indexOf("[");
  if (start < 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(jsonrepair(raw.slice(start)));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): ReverseCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const en = str(row.en);
    if (!en) return [];
    const levelRaw = typeof row.level === "string" ? row.level.trim().toUpperCase() : "";
    return [{
      en,
      wordType: str(row.word_type),
      level: VALID_LEVELS.find((l) => l === levelRaw),
      zh: str(row.zh),
      note: str(row.note),
      example: str(row.example),
      exampleZh: str(row.example_zh),
    }];
  }).slice(0, 4);
}

/**
 * Streams English candidates for a Chinese query, invoking `onUpdate` with
 * the full candidate list every time the partial response reparses — so the
 * search box fills in card by card rather than after one long wait.
 * Never throws except for AbortError, which callers already handle; any
 * other failure resolves to whatever had parsed so far (usually []).
 */
export async function fetchReverseLookup(
  provider: AIProvider,
  text: string,
  targetLevel: string,
  onUpdate: (candidates: ReverseCandidate[]) => void,
  signal?: AbortSignal
): Promise<ReverseCandidate[]> {
  let raw = "";
  let candidates: ReverseCandidate[] = [];
  for await (const chunk of provider.generate(REVERSE_LOOKUP_SYSTEM_PROMPT, buildReverseLookupUserPrompt(text, targetLevel), signal)) {
    if (signal?.aborted) return candidates;
    raw += chunk;
    // The entry still being written is repaired into a half-typed word
    // ("hesi") — hold it back until the object closes, so cards land whole
    // instead of visibly correcting themselves.
    const next = parseReverseLookup(raw).slice(0, -1);
    if (next.length > candidates.length) {
      candidates = next;
      onUpdate(candidates);
    }
  }
  const final = parseReverseLookup(raw);
  if (final.length) {
    candidates = final;
    onUpdate(candidates);
  }
  return candidates;
}
