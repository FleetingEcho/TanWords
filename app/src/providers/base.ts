export interface TranslateParams {
  text: string;
  targetLang: string;
  sourceLang?: string;
  mode: "translate" | "polish" | "summarize";
}

export interface ExplainParams {
  text: string;
  mode?: "grammar" | "syntax" | "rewrite";
}

export interface WordEnrichment {
  definitions: Definition[];
  synonyms: Relation[];
  antonyms: string[];
  collocations: string[];
  derivatives: Derivative[];
  sentencePatterns: Pattern[];
  idioms: Idiom[];
  authorityQuotes: Quote[];
  /** AI-generated example sentences (no real sources, just high-quality examples) */
  sentences: Sentence[];
  etymology: Etymology;
  level: CEFRLevel;
  mnemonic: string;
}

export interface Definition {
  pos: string;
  zh: string;
  en: string;
  exampleEn: string;
  exampleZh: string;
}

export interface Relation {
  word: string;
  note: string;
  noteZh?: string;
}

export interface Derivative {
  word: string;
  wordType: string;
  zh: string;
}

export interface Pattern {
  pattern: string;
  explanation: string;
  example: string;
}

export interface Idiom {
  idiom: string;
  explanation: string;
  example: string;
}

export interface Quote {
  text: string;
  source: string;
}

export interface Sentence {
  text: string;
  label: string;
}

export interface Etymology {
  parts: { seg: string; role: string; meaning: string }[];
  story: string;
  originLang: string;
}

export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

// ── Tool Calling Types ──────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ApiMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolCallResponse {
  textContent: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: "end_turn" | "tool_use" | "error";
}

// ── Provider Interface ──────────────────────────────────────────────────────

export interface AIProvider {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  isCustom: boolean;

  translate(params: TranslateParams): AsyncGenerator<string>;
  explain(params: ExplainParams): AsyncGenerator<string>;
  enrich(word: string, signal?: AbortSignal): AsyncGenerator<Partial<WordEnrichment>>;
  /** Free-form streaming chat with a custom system prompt */
  generate(systemPrompt: string, userPrompt: string): AsyncGenerator<string>;
  /** Multi-turn streaming chat */
  chat(messages: Array<{ role: "user" | "assistant"; content: string }>, systemPrompt: string, signal?: AbortSignal): AsyncGenerator<string>;
  /** Multi-turn chat with tool calling support. Streams text via onText callback, returns collected tool calls. */
  chatWithTools?(
    messages: ApiMessage[],
    systemPrompt: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    onText?: (chunk: string) => void,
  ): Promise<ToolCallResponse>;
}

export function buildSystemPrompt(mode: TranslateParams["mode"]): string {
  switch (mode) {
    case "translate":
      return "You are a professional translator. Translate the following text accurately and naturally. Return ONLY the translation, no explanations.";
    case "polish":
      return "You are a professional editor. Polish the following text to improve its clarity, style, and naturalness while preserving the original meaning. Return ONLY the polished text.";
    case "summarize":
      return "You are a professional summarizer. Summarize the following text concisely in the target language. Return ONLY the summary.";
  }
}
