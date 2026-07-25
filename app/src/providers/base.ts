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
  /** Streams the raw markdown explanation chunk by chunk, for a typewriter
   * effect. This is prose only — word_type/level/short gloss for the word
   * list come from the separate structured `fetchBasicInfo` call
   * (src/lib/basicInfo.ts), not from parsing this stream. */
  enrich(word: string, signal?: AbortSignal): AsyncGenerator<string>;
  /** Free-form streaming chat with a custom system prompt */
  generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): AsyncGenerator<string>;
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

正文完全自由，不设固定格式：根据这个词值得讲的内容自行组织（核心释义、常见用法、易混淆点、词源、记忆方法等），该长则长、该短则短，无需覆盖每一类内容。但以下两点是硬性要求：

1. **例句要多、要覆盖不同场景**：至少给 4-6 条例句，覆盖这个词的不同词义/词性（如果有多个）、不同语域（日常口语、书面/学术、新闻财经等），不要只给一条敷衍了事。每条例句都要能体现这个词在真实语境里怎么用，而不是干巴巴的造句。
2. **常见用法要讲透**：搭配（collocations）、常见句型/介词搭配、近义词之间的细微差别、什么场合该用/不该用这个词——这些内容按需展开，不要一笔带过。

英文例句一律写成 markdown blockquote（\`> \` 开头），一条 blockquote 一句英文例句，可在同一 blockquote 内下一行附中文翻译。

直接从讲解正文开始，不要有任何与词义无关的内容：不要开场白（如"当然可以""我们来深度拆解一下"之类的寒暄或过渡句），不要结尾互动语（如反问学习者最近的经历、邀请学习者造句、"轮到你了"之类的话术）。整段内容从头到尾都必须是词汇讲解本身。`;

export function buildEnrichSystemPrompt(customPrompt?: string): string {
  if (customPrompt?.trim()) return customPrompt;
  return DEFAULT_ENRICH_SYSTEM_PROMPT;
}

export function buildEnrichUserPrompt(word: string, targetLevel: string): string {
  return `请讲解这个英文单词："${word}"（学习者目标水平：${targetLevel}）`;
}

/** Short-form counterpart to DEFAULT_ENRICH_SYSTEM_PROMPT: a one-line gloss
 * plus 2 examples instead of the full breakdown, for a fast inline preview
 * before the learner commits to adding the word or asking for the deep
 * analysis (see buildEnrichSystemPrompt). Rendered with EnrichmentText like
 * any other enrichment. */
export const QUICK_LOOKUP_SYSTEM_PROMPT = `你是一位英语词汇助手，用中文为学习者快速讲解一个英文单词或短语。

正文务必简短快速：先一到两句中文释义（多义词只挑最常用的一个），紧接着给 2 条例句，不展开讲搭配、词源等内容。英文例句一律写成 markdown blockquote（\`> \` 开头），一条 blockquote 一句英文例句，可在同一 blockquote 内下一行附中文翻译。

直接从释义开始，不要任何开场白或结尾互动语（寒暄、"轮到你了"之类邀请学习者造句/分享经历的话术），全程只讲这个词。`;

export function buildQuickLookupUserPrompt(word: string, targetLevel: string): string {
  return `请快速讲解这个英文单词或短语："${word}"（学习者目标水平：${targetLevel}）`;
}

/** Structured, non-streaming counterpart to the free-form enrich prompts
 * above: returns strictly the "authoritative basic info" the word list
 * needs (part of speech, CEFR level, one-line Chinese gloss) as JSON — kept
 * separate from the prose explanation so the list is never at the mercy of
 * a model that forgets to follow an embedded metadata-line convention. See
 * src/lib/basicInfo.ts for the call + parser. */
export const BASIC_INFO_SYSTEM_PROMPT = `你是一个词典数据生成器。给定一个英文单词或短语，输出它最常用、最权威的基本信息，用于学习卡片列表的摘要行。

只返回一个 JSON 对象，不要任何其他文字、不要代码块标记、不要解释：
{"word_type":"<词性缩写，如 n/v/adj/adv/prep/conj/pron/phrase，多个词性用 / 分隔，如 n/v>","level":"<CEFR等级，仅限 A1|A2|B1|B2|C1|C2>","zh":"<10字以内、这个词最常用义项的中文短释义>"}

只给这个词最常见、最核心的那个义项，不要罗列多个义项，不要输出别的字段。`;

export function buildBasicInfoUserPrompt(word: string, targetLevel: string): string {
  return `单词或短语："${word}"（学习者目标水平：${targetLevel}）`;
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
