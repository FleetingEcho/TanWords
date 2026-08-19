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
  /** Whether the provider can attempt API calls right now. Cloud providers
   *  need `apiKey`; a self-hosted OpenAI-compatible server (Ollama, LM
   *  Studio) usually accepts keyless requests, so CustomProvider relaxes
   *  this. Selection and "available providers" pickers must gate on this,
   *  never on `apiKey` directly — a keyless local provider is a fully
   *  configured one. */
  readonly hasCredentials: boolean;

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

真正关键的地方用 \`==高亮==\` 标出（markdown 高亮语法，两个等号包裹）：比如核心释义里最能定性的那几个字、最值得记住的搭配、最容易踩的坑。只标最重要的，一段最多一两处，标太多等于没标。不要用 \`==\` 包裹整句话或整条例句。

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

释义里最关键的几个字用 \`==高亮==\` 标出（markdown 高亮语法，两个等号包裹），全文最多一处。

直接从释义开始，不要任何开场白或结尾互动语（寒暄、"轮到你了"之类邀请学习者造句/分享经历的话术），全程只讲这个词。`;

export function buildQuickLookupUserPrompt(word: string, targetLevel: string): string {
  return `请快速讲解这个英文单词或短语："${word}"（学习者目标水平：${targetLevel}）`;
}

/** Reverse (Chinese → English) lookup for the search box: given a Chinese
 * word or phrase, return up to 4 English candidates as a JSON array so each
 * one can be rendered as its own card with its own "add to vocabulary"
 * action — a prose answer couldn't be split back apart. Streamed and parsed
 * incrementally (see src/lib/reverseLookup.ts) so cards appear one by one. */
export const REVERSE_LOOKUP_SYSTEM_PROMPT = `你是一个中英词汇检索器。给定一个中文词或短语，找出最贴切的英文表达，供中文母语学习者挑选。

只返回一个 JSON 数组，不要任何其他文字、不要代码块标记、不要解释：
[{"en":"<英文单词或短语>","word_type":"<词性缩写，如 n/v/adj/adv/phrase>","level":"<CEFR等级，仅限 A1|A2|B1|B2|C1|C2>","zh":"<10字以内的中文释义>","note":"<20字以内的辨析：这个词区别于其他候选的语义侧重、语域或搭配场景>","example":"<一句地道英文例句，用到这个词>","example_zh":"<该例句的中文翻译>"}]

规则：
- 给 3 到 4 个候选，按贴切程度从高到低排序：第一个是最标准的对应，其余可以是近义词、更具体或更宽泛的说法、不同语域（正式/书面/口语/俚语）的说法、或母语者常用的短语说法。学习者要的是这个中文周围的一小片英文词汇，不是一个标准答案。
- 只有当这个中文确实凑不出第三个母语者会用的表达时，才允许少于 3 个。宁可给一个语义稍偏但真实、常用的相关词，也不要只给一两个就收尾；但绝不编造生造词或几乎无人使用的词。
- 候选之间必须有实质区分度（语义侧重、语域、搭配对象、褒贬），不要罗列可完全互换的同义词。
- note 只写"和别的候选比该选谁"，不要复述 zh 的释义。
- 若输入本身是英文或无法理解，返回 []。`;

export function buildReverseLookupUserPrompt(text: string, targetLevel: string): string {
  return `中文词或短语："${text}"（学习者目标水平：${targetLevel}）`;
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

/** Explains whatever the learner selected — a word, a phrase, or a whole
 *  sentence — in place, with the surrounding text as context. One prompt for
 *  all three because the selection's shape isn't known until it happens, and
 *  the model can see which it is. See components/shared/SelectionAsk.tsx. */
export const INLINE_ASK_SYSTEM_PROMPT = `你是一位英语老师，学习者正在读一篇英文文章，选中了其中一段文字向你提问。用中文讲解，要简短、直接、切中这段文字在**当前上下文里**的实际含义。

根据选中内容的类型来组织回答：
- 单词或短语：先给它在这里的意思（不是词典里的所有义项），再补一句它的常见搭配或语域，最后给 1 条另造的例句。
- 完整句子：先给自然的中文翻译，再用一两句话点出这句的结构或值得学的表达（句式、时态、修辞、地道搭配），不要逐词翻译。
- 其他（片段、术语、缩写）：直接解释它是什么、在这里起什么作用。

全文控制在 120 字以内。直接开始讲解，不要复述选中的内容，不要开场白，不要结尾的互动邀请。英文例句用 markdown blockquote（\`> \` 开头）。`;

export function buildInlineAskUserPrompt(selection: string, context: string, targetLevel: string): string {
  const ctx = context.trim() ? `\n\n所在段落（仅供参考，不要另外讲解它）：\n"""\n${context.trim()}\n"""` : "";
  return `选中的内容："${selection}"（学习者目标水平：CEFR ${targetLevel}）${ctx}`;
}

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
