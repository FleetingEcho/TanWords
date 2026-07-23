export interface TranslateParams {
  text: string;
  targetLang: string;
  sourceLang?: string;
  mode: "translate" | "polish" | "summarize";
  /** Set when `text` is a batch of segments delimited by `@@id@@` markers (see
   * lib/hnComments.ts's serializeCommentsForTranslation) — asks the model to
   * preserve every marker verbatim so the response can be split back apart. */
  preserveMarkers?: boolean;
}

export interface ExplainParams {
  text: string;
  mode?: "grammar" | "syntax" | "rewrite";
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
  /** Streams the raw markdown explanation (including the still-unparsed
   * META line) chunk by chunk, for a typewriter effect. Callers parse the
   * final accumulated text with `parseEnrichmentStream`. */
  enrich(word: string, signal?: AbortSignal): AsyncGenerator<string>;
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

export const DEFAULT_ENRICH_SYSTEM_PROMPT = `你是一位资深词汇讲解者，面向 CEFR C1/C2 中文母语学习者，用中文讲解英文单词。

第一行必须是固定格式的元数据行：\`META: <CEFR等级，如 C1> | <10字以内的中文短释义>\`，然后空一行，再开始正文。

正文完全自由，不设固定格式：根据这个词值得讲的内容自行组织（核心释义、常见用法、易混淆点、词源、记忆方法等），该长则长、该短则短，无需覆盖每一类内容。但以下两点是硬性要求：

1. **例句要多、要覆盖不同场景**：至少给 4-6 条例句，覆盖这个词的不同词义/词性（如果有多个）、不同语域（日常口语、书面/学术、新闻财经等），不要只给一条敷衍了事。每条例句都要能体现这个词在真实语境里怎么用，而不是干巴巴的造句。
2. **常见用法要讲透**：搭配（collocations）、常见句型/介词搭配、近义词之间的细微差别、什么场合该用/不该用这个词——这些内容按需展开，不要一笔带过。

英文例句一律写成 markdown blockquote（\`> \` 开头），一条 blockquote 一句英文例句，可在同一 blockquote 内下一行附中文翻译。`;

export function buildEnrichSystemPrompt(customPrompt?: string): string {
  if (customPrompt?.trim()) return customPrompt;
  return DEFAULT_ENRICH_SYSTEM_PROMPT;
}

export function buildEnrichUserPrompt(word: string, targetLevel: string): string {
  return `请讲解这个英文单词："${word}"（学习者目标水平：${targetLevel}）`;
}

export function buildSystemPrompt(mode: TranslateParams["mode"], opts?: { preserveMarkers?: boolean }): string {
  const markerNote = opts?.preserveMarkers
    ? " The text is a batch of separate segments, each preceded by a marker on its own line looking like @@123@@. Copy every marker exactly as-is (same characters, same line, never translated, reformatted, merged, reordered, added, or dropped) immediately before that segment's translation, so the segments can be matched back up by marker afterwards."
    : "";
  switch (mode) {
    case "translate":
      return "You are a professional translator. Translate the following text accurately and naturally, verbatim — even if it looks repetitive, disjointed, or like it mixes in unrelated content. Never comment on, summarize, fix, reorganize, or omit any part of the source; translate exactly what is given, in the same order. Return ONLY the translation, with no commentary, notes, or explanations of any kind." + markerNote;
    case "polish":
      return "You are a professional editor. Polish the following text to improve its clarity, style, and naturalness while preserving the original meaning. Return ONLY the polished text." + markerNote;
    case "summarize":
      return "You are a professional summarizer. Summarize the following text concisely in the target language. Return ONLY the summary." + markerNote;
  }
}
