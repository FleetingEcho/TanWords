import { CEFRLevel } from "@/providers/base";

const VALID_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface ParsedEnrichment {
  text: string;
  zhShort?: string;
  /** Plain string, not CEFRLevel — mirrors the DB's `words.level` column,
   * which callers (e.g. an existing Reading-supplied level) may set to
   * anything. */
  level?: string;
}

/**
 * Some locally-served reasoning models (DeepSeek-R1, QwQ, etc.) emit their
 * chain-of-thought inline in the content stream as `<think>...</think>`
 * instead of a separate reasoning field. Strip it — including an
 * as-yet-unclosed block while the model is still "thinking" mid-stream —
 * so it never reaches the rendered enrichment text.
 */
function stripThinkTags(raw: string): string {
  let out = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  out = out.replace(/<think(?:ing)?>[\s\S]*$/i, "");
  return out;
}

/**
 * Parses the `META: <level> | <short gloss>` first line an enrich() stream
 * is prompted to emit, stripping it from the body. Falls back to treating
 * the whole stream as body text if the model didn't follow the format —
 * level/zhShort are just omitted, never blocking a save.
 */
export function parseEnrichmentStream(rawInput: string): ParsedEnrichment {
  const raw = stripThinkTags(rawInput).replace(/^\s*\n+/, "");
  const newlineIdx = raw.indexOf("\n");
  const firstLine = newlineIdx === -1 ? raw : raw.slice(0, newlineIdx);
  const match = firstLine.match(/^META:\s*([A-Za-z0-9]+)\s*\|\s*(.+?)\s*$/);
  if (!match) return { text: raw.trim() };

  const [, levelRaw, zhShort] = match;
  const level = VALID_LEVELS.find((l) => l === levelRaw.toUpperCase() as CEFRLevel);
  const rest = newlineIdx === -1 ? "" : raw.slice(newlineIdx + 1).replace(/^\s*\n/, "");

  return { text: rest.trim(), zhShort: zhShort.trim() || undefined, level };
}
