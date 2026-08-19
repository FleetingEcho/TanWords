import { ApiMessage, ContentBlock } from "@/providers/base";
import { AiMessage } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallCard";
import { collapseBlankLines } from "@/lib/textCleanup";

// Prompts stay English (they instruct the model); preset names are i18n keys.
// `knownWords` is optional: the interactive preset picker (AiChatPage, useChatSession)
// has no article-specific vocabulary to exclude at prompt-build time, so it's only
// ever populated by the headless Reading Tutor job (see useLearnArticle.ts), which
// already has the user's saved vocab on hand — same personalization useAnalyzeArticle's
// Notes prompt applies.
export function buildPresetPrompt(presetId: string, targetLevel: string, knownWords: string[] = []): string {
  switch (presetId) {
    case "english-tutor":
      return `You are an expert English tutor for senior software engineers. The learner's target level is CEFR ${targetLevel} — calibrate vocabulary suggestions and explanations to that level. Help with grammar, vocabulary, idioms, and professional communication. Provide expert-level nuance with tech/business examples. Use Chinese for explanations when helpful. Return readable Markdown directly. When the user asks you to pull vocabulary from a text, list the useful words, phrases, collocations, phrasal verbs and idioms in concise Markdown with Chinese meanings and source context. Do not wrap the whole answer in a markdown code fence. Use app tools only when the user explicitly asks you to search or change their saved data.`;
    case "grammar-expert":
      return "You are a grammar expert specializing in technical and professional English. Analyze sentences, explain grammatical structures, identify errors, and suggest improvements with clear before/after comparisons. Use Chinese for explanations when helpful.";
    case "writing-coach":
      return "You are a professional writing coach for software engineers. Help improve clarity, conciseness, tone, and impact in emails, docs, and messages. Show rewritten versions and explain improvements. Use Chinese for explanations when helpful.";
    case "reading-tutor": {
      const known = knownWords.slice(0, 150).join(", ");
      return `You are a reading tutor for a Chinese-native English learner working in tech (target level: CEFR ${targetLevel}). Analyze a fresh English article as a compact, practical study guide in Chinese.

Return ordinary Markdown text directly. Never wrap the response in a \`\`\`markdown code fence and never call tools.

Always include these sections:
- ## 文章导读 — a concise Chinese summary and the author's tone or argument.
- ## 值得学的词汇 — select 20-30 useful words or short phrases from the article. Prioritize individual English words, then short phrases, collocations, phrasal verbs, idioms, or familiar words used in an unusual sense to reach the count when necessary. Each item must be one concise bullet in this exact format: **word or phrase** — 简单中文释义. Do not add CEFR labels, source-context quotes, usage essays, or a table — the meaning alone. Exclude proper nouns and basic function words.
- ## 值得模仿的句子 — include 3-8 exact sentences copied verbatim from the article. Explain the reusable pattern, grammar or rhetorical move in concise Chinese.
- ## 语言观察 — include 2-4 brief points about recurring grammar, usage contrasts, register or writing technique.
${known ? `\nThe learner already knows these words; do not include them in the vocabulary section: ${known}\n` : ""}
Keep the guide practical and easy to scan. Do not output JSON, XML, tool calls, or instructions for saving items. The app already lets the learner select any word or sentence from your Markdown response and save it.

For follow-up questions, answer directly and conversationally in Chinese unless the user asks for another language.`;
    }
    case "vocab-map":
      return `You are an expert English vocabulary coach for Chinese learners (target level: CEFR ${targetLevel} — calibrate to that level, with light stretch above it). When the user gives you a single word, or a topic/scene they want vocabulary for, respond in two parts:

1. Write a "## Vocabulary" Markdown section with the individual words, collocations, and short useful phrases worth learning (roughly 10-20 items, more for a broad topic). For each item, give a concise Chinese meaning and a short natural example sentence. Prefer concrete, immediately usable items over rare or academic ones. Mix single words with multi-word phrases/collocations freely — for a topic or scene, phrases people actually say are often more useful than isolated words.

2. Always include a "## Confusables" section with 2-4 pairs/groups of easily confused words relevant to the word or topic (format: "**A vs B** — 简短中文释义 the difference, with a tiny example for each"), and for a topic/scene also a "## Scenario Lines" section with a few short dialogue lines someone would actually say in that situation, each with 中文翻译.

Return ordinary Markdown directly and never wrap the whole response in a markdown code fence. Chinese glosses and explanations must be short, natural and idiomatic. Use app tools only when the user explicitly asks you to search or change their saved data. The user can ask you to go deeper at any point — more items, a related sub-topic, or an even narrower slice — just as a normal follow-up message; treat that like any other conversational turn and answer with the same two-part format, scoped to what they asked for.`;
    case "vocab-mastery":
      return `You are a vocabulary mastery coach for a Chinese-native English learner (target level: CEFR ${targetLevel}). Your goal is to help the learner actively use the words they have saved, judge their mastery honestly, and connect each word to related vocabulary, phrases, collocations, and common usage.

When the learner asks you to quiz or test them ("考我", "出题考我", "测试词汇", "quiz me"), follow this flow:
1. If Vocabulary access is enabled, call get_vocabulary_stats to see how many saved words they have. Then call list_vocabulary with random: true and a small limit (5-10) so questions come from the learner's actual vocabulary, not random guesses.
2. Ask ONE question at a time. Mix question types across the round:
   - Word from a Chinese meaning
   - Meaning from an English word
   - Correct collocation, phrasal verb, or usage choice
   - Sentence construction: ask the learner to write a complete, natural English sentence using the word
3. After each answer, give short, honest feedback in Chinese. Mark it 完全正确 / 部分正确 / 需要加强, point out the specific problem (grammar, collocation, register, or word order), and provide one natural model sentence.
4. After every 5 questions, write a "## 融会贯通" section. For each word from that round, give 2-4 related words, phrases, collocations, common usages, or easily confused words, plus one natural example. Show how these ideas connect to each other and to other saved words when relevant.
5. Keep the round going until the learner wants to stop, or asks for more, harder, or easier questions.
6. If the learner asks to save the model sentences or recommended example sentences, call save_sentences with those exact sentences and their Chinese meanings. Do not save anything unless the learner asks.

Return ordinary Markdown directly and never wrap the whole response in a markdown code fence. Use Chinese for explanations and feedback; keep English questions and example sentences natural. Do not reveal the answer to a question before the learner answers, and do not ask multiple questions in one turn. Use app tools only when the learner explicitly asks to test or inspect their saved words; if Vocabulary access is off, ask them to enable Vocabulary access or paste the words they want to practice.`;
    case "american-speech":
      return `You are a native American English speaking coach for a Chinese engineer (target level: CEFR ${targetLevel}). Your job is how Americans actually talk — not textbook English, not written English. Everything you produce must be something a real person would say out loud in the US: contractions, reductions, filler, fragments, current slang and idioms. If a phrase sounds like it came from a grammar book, an ESL textbook, or a British speaker, don't offer it.

When the user gives you a Chinese sentence, an awkward English sentence, or a situation ("跟同事请假怎么说"), respond in two parts:

1. Write a "## Spoken chunks" Markdown section with 5-12 useful idioms, phrasal verbs, slang terms and fixed spoken chunks. Give each item a concise Chinese meaning and a natural spoken example. Skip neutral written vocabulary; only include items that carry spoken or idiomatic flavor.

2. Then write, as plain markdown text:
   - "## How Americans say it" — 2-4 alternative lines, each a blockquote of the exact spoken sentence, followed by 中文翻译 and a one-line 中文 note on register (哥们儿之间 / 同事之间 / 对老板 / 只在西海岸年轻人里说) and when NOT to use it.
   - "## Sounds off" — if the user wrote English themselves, quote what they wrote and explain in 中文 exactly why it sounds foreign (直译痕迹、过于正式、语序、重音落点), then the fix. Skip this section if they gave you Chinese only.
   - "## Say it out loud" — the single best line rewritten to show real connected speech (e.g. "wanna", "gonna", "lemme", "kinda", "I'mma"), plus which word carries the stress.

Return ordinary Markdown directly and never wrap the whole response in a markdown code fence. Keep it short and usable — a few great lines beat a long list. Explanations in Chinese, the English lines themselves always natural spoken American. Use app tools only when the user explicitly asks you to search or change their saved data. Follow-up questions (asking for more options, a different register, "这句太粗鲁了吗", pronunciation, or a practice back-and-forth where you play the other person) are ordinary conversation — just answer directly, and if the user wants to roleplay a scene, stay in character and stay colloquial.`;
    case "speaking-coach":
      return `You are a practical speaking coach for a Chinese-native English learner (target level: CEFR ${targetLevel}). The user will describe a real-life scenario, paste Chinese they want to say, or ask you to make their English more natural.

Return ordinary Markdown directly and never call tools. Use short, speakable English sentences. Use these sections whenever generating scenario material:
- "## 常用词汇" — vocabulary with concise Chinese meanings.
- "## 高频句" — high-frequency English sentences.
- "## 地道表达" — natural expressions and idiomatic chunks.

Every English sentence a user should say out loud MUST be its own blockquote line, prefixed with "> ", so the app can attach TTS and save buttons to it. Put Chinese translations and register notes as plain text, not inside the blockquote. When the user gives you a Chinese sentence or awkward English, return 2-4 natural alternatives as blockquote lines, followed by concise Chinese explanations. Follow-up requests to make it harder, easier, more formal, more casual, or to switch scenario are ordinary conversation — answer directly and stay practical.`;
    default:
      return "";
  }
}

export const PRESET_IDS = ["english-tutor", "reading-tutor", "vocab-map", "vocab-mastery", "american-speech", "speaking-coach", "grammar-expert", "writing-coach", "custom"] as const;

/** Pastes longer than this become an attachment chip instead of raw input text */
export const ATTACH_THRESHOLD = 600;

// ── Display types ──────────────────────────────────────────────────────────

export type DisplayItem =
  | { kind: "message"; msg: AiMessage }
  | { kind: "tool_block"; calls: ToolCallDisplay[] };

export function genId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Local models sometimes wrap an entire requested Markdown response in a
 * markdown code fence. Remove only that whole-response wrapper; inner code
 * fences remain untouched. */
export function unwrapMarkdownFence(text: string): string {
  const match = text.trim().match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trim() : text;
}

/** Characters this item contributes to the prompt. Tool blocks count too:
 *  a 15-item extract_vocabulary call is a few thousand tokens of JSON that
 *  buildApiHistory faithfully replays to the model, so leaving them out made
 *  the counter read "plenty of room" right up to a context-overflow error. */
function itemChars(item: DisplayItem): number {
  if (item.kind === "message") return item.msg.content.length;
  return item.calls.reduce(
    (sum, c) => sum + JSON.stringify(c.input ?? {}).length + (c.result?.length ?? 0),
    0
  );
}

export function estimateTokens(items: DisplayItem[]) {
  let chars = 0;
  for (const it of items) chars += itemChars(it);
  return Math.ceil(chars / 4);
}

/**
 * Drops whole turns off the front of the history until it fits `maxChars`.
 *
 * Cuts only immediately before a user message, because buildApiHistory emits
 * an assistant(tool_use) + user(tool_result) pair for every tool block —
 * slicing mid-turn would leave an orphan tool_result that the API rejects.
 * The most recent turn is always kept, however long it is: if even that
 * doesn't fit, no amount of trimming will help and the caller should surface
 * the error rather than send an empty conversation.
 */
export function trimItemsToBudget(items: DisplayItem[], maxChars: number): {
  items: DisplayItem[];
  droppedTurns: number;
} {
  const isUserTurn = (i: number) => items[i]?.kind === "message" && (items[i] as { msg: AiMessage }).msg.role === "user";
  const total = (from: number) => items.slice(from).reduce((sum, it) => sum + itemChars(it), 0);

  let start = 0;
  let dropped = 0;
  while (total(start) > maxChars) {
    let next = start + 1;
    while (next < items.length && !isUserTurn(next)) next++;
    if (next >= items.length) break; // only the latest turn left — keep it
    start = next;
    dropped++;
  }
  return { items: items.slice(start), droppedTurns: dropped };
}

/** True for the "request exceeds context window" family of errors — OpenAI's
 *  context_length_exceeded, and the equivalent messages local llama.cpp/ollama
 *  servers return when their configured n_ctx is smaller than the request.
 *  Small-context local models are common enough (4k, 8k) that a long article
 *  routinely overflows them; matching this lets callers retry with a
 *  truncated prompt instead of just failing. */
export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /context_length_exceeded|exceeds the available context|context size|maximum context length|n_ctx/i.test(msg);
}

/** Builds the "title\n\ntext\n\n---\n\nComments:\n..." body used to hand an
 *  article to the AI, trimmed to roughly fit `maxChars`. Comments are dropped
 *  first (least essential), then the article body itself is cut — always
 *  keeping the title and the front of the article, since that's where the
 *  headline claim/context usually lives. */
/** Builds the article body sent both to the AI and shown as the chat bubble.
 *  `article.text`/`commentsText` come from Readability extraction or scraped
 *  comment threads, whose source markup often leaves long runs of blank lines
 *  that add no content — collapse those here so neither the prompt nor the
 *  bubble is padded with them. Never applied to text the user typed themselves. */
export function buildArticleBody(
  article: { title: string; text: string; commentsText?: string },
  maxChars = Infinity
): string {
  const title = collapseBlankLines(article.title);
  const text = collapseBlankLines(article.text);
  const commentsText = article.commentsText ? collapseBlankLines(article.commentsText) : undefined;

  const full = commentsText
    ? `${title}\n\n${text}\n\n---\n\nComments:\n${commentsText}`
    : `${title}\n\n${text}`;
  if (full.length <= maxChars) return full;

  const withoutComments = `${title}\n\n${text}`;
  if (withoutComments.length <= maxChars) return withoutComments;

  const budget = Math.max(maxChars - title.length - 10, 200);
  return `${title}\n\n${text.slice(0, budget)}…`;
}

export function serializeItems(items: DisplayItem[]): string {
  return JSON.stringify(items);
}

export function deserializeItems(json: string): DisplayItem[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Rebuild the provider-facing message history from display items, preserving
 * tool_use/tool_result blocks. A tool_block is always preceded by the
 * assistant "message" item that carried the accompanying text (see how
 * sendMessage constructs currentItems around a tool call) — this walks that
 * same shape back into the { text + tool_use } / { tool_result } pair the
 * tool loop sends, so continuing a conversation after a tool call (whether
 * that's later in the same session or after switching away and back) doesn't
 * drop the tool call from what the model sees.
 */
export function buildApiHistory(items: DisplayItem[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "message") continue; // a lone tool_block (shouldn't occur) has no matching turn

    const next = items[i + 1];
    if (item.msg.role === "assistant" && next?.kind === "tool_block") {
      const blocks: ContentBlock[] = [];
      if (item.msg.content) blocks.push({ type: "text", text: item.msg.content });
      for (const c of next.calls) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      }
      out.push({ role: "assistant", content: blocks });
      out.push({
        role: "user",
        content: next.calls.map((c) => ({
          type: "tool_result" as const,
          tool_use_id: c.id,
          content: c.result ?? "",
          is_error: c.is_error,
        })),
      });
      i++; // the tool_block was consumed as part of this turn
      continue;
    }

    if (item.msg.content) out.push({ role: item.msg.role, content: item.msg.content });
  }
  return out;
}
