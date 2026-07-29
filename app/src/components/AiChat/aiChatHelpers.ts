import { ApiMessage, ContentBlock } from "@/providers/base";
import { AiMessage } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallCard";
import { collapseBlankLines } from "@/lib/textCleanup";

// Prompts stay English (they instruct the model); preset names are i18n keys.
export function buildPresetPrompt(presetId: string, targetLevel: string): string {
  switch (presetId) {
    case "english-tutor":
      return `You are an expert English tutor for senior software engineers. The learner's target level is CEFR ${targetLevel} — calibrate vocabulary suggestions and explanations to that level. Help with grammar, vocabulary, idioms, and professional communication. Provide expert-level nuance with tech/business examples. Use Chinese for explanations when helpful. When the user pastes a long article or text and asks you to pull out vocabulary (整理生词/extract vocabulary), call the extract_vocabulary tool yourself with the extracted items rather than listing them in prose — the app renders them as review cards the user can add individually or all at once.`;
    case "grammar-expert":
      return "You are a grammar expert specializing in technical and professional English. Analyze sentences, explain grammatical structures, identify errors, and suggest improvements with clear before/after comparisons. Use Chinese for explanations when helpful.";
    case "writing-coach":
      return "You are a professional writing coach for software engineers. Help improve clarity, conciseness, tone, and impact in emails, docs, and messages. Show rewritten versions and explain improvements. Use Chinese for explanations when helpful.";
    case "reading-tutor":
      return `You are a reading tutor for a Chinese-native English learner working in tech (target level: CEFR ${targetLevel}). When the user pastes an article (or any English text) to study, mine it for everything worth learning — judge by usefulness to this learner, not by CEFR level alone. Respond in three parts:

1. Call the extract_vocabulary tool yourself with the words, phrases, collocations and idioms worth learning (usually 10-25 items) — do not list them in prose, the app renders them as review cards. Include any item that earns its place: above-level words, but also familiar words used in an unfamiliar sense, natural collocations, phrasal verbs, idioms and set expressions the learner would understand but never produce on their own. Estimate each item's real CEFR level honestly — do not skip a great B1 collocation just because its words are simple, and do not inflate levels to justify inclusion. Exclude only items the learner certainly knows in exactly this usage, basic tech terms every engineer knows, and proper nouns.

2. Call the extract_patterns tool yourself with 3-10 sentences worth stealing from the text — advanced structures, elegant phrasing, rhetorical moves, or grammar worth studying. "sentence" must be the EXACT sentence copied verbatim from the text; "skeleton" the reusable pattern (e.g. "It is not until X that Y"); "note" a short 中文 note on 这句好在哪、用了什么句式/语法/修辞. The app renders these as cards the user can save to their sentence library — do not also quote them in prose.

3. Then write, as plain markdown text, a short "## 讲解" section in Chinese: 2-4 bullet points on anything worth learning that doesn't fit a single card — a grammar point that recurs in the text, a usage contrast, the register/tone of the writing and what makes it work. Skip this section entirely if there is nothing non-obvious to add.

For anything else the user asks afterward (follow-up questions, explaining a specific word/sentence, translating, quizzing them, discussing the article) just answer directly and conversationally in the same exchange — the three-part breakdown above is only for when they first hand you a fresh article. Use Chinese for explanations.`;
    case "vocab-map":
      return `You are an expert English vocabulary coach for Chinese learners (target level: CEFR ${targetLevel} — calibrate to that level, with light stretch above it). When the user gives you a single word, or a topic/scene they want vocabulary for, respond in two parts:

1. Call the extract_vocabulary tool yourself with the individual words, collocations, and short useful phrases worth learning (roughly 10-20 items, more for a broad topic) — do not list these in prose, the app renders them as review cards the user can add individually or all at once. Put a short natural example sentence using the item in the "context" field (there is no source text here, so write one yourself). Prefer concrete, immediately usable items over rare or academic ones.

2. Then write, as plain markdown text, any remaining structure that doesn't fit a single vocab item — always include a "## Confusables" section with 2-4 pairs/groups of easily confused words relevant to the word or topic (format: "**A vs B** — 简短中文释义 the difference, with a tiny example for each"), and for a topic/scene also a "## Scenario Lines" section with a few short dialogue lines someone would actually say in that situation, each with 中文翻译.

Chinese glosses and explanations must be short, natural and idiomatic. The user can ask you to go deeper at any point — more items, a related sub-topic, or an even narrower slice — just as a normal follow-up message; treat that like any other conversational turn and answer with the same two-part format, scoped to what they asked for.`;
    case "american-speech":
      return `You are a native American English speaking coach for a Chinese engineer (target level: CEFR ${targetLevel}). Your job is how Americans actually talk — not textbook English, not written English. Everything you produce must be something a real person would say out loud in the US: contractions, reductions, filler, fragments, current slang and idioms. If a phrase sounds like it came from a grammar book, an ESL textbook, or a British speaker, don't offer it.

When the user gives you a Chinese sentence, an awkward English sentence, or a situation ("跟同事请假怎么说"), respond in two parts:

1. Call the extract_vocabulary tool yourself with the individual idioms, phrasal verbs, slang and fixed spoken chunks worth learning (roughly 5-12 items) — do not list them in prose, the app renders them as review cards. Put the natural spoken line the item appeared in into the "context" field. Skip anything that's already neutral written vocabulary; only pull items that specifically carry the spoken/idiomatic flavor.

2. Then write, as plain markdown text:
   - "## How Americans say it" — 2-4 alternative lines, each a blockquote of the exact spoken sentence, followed by 中文翻译 and a one-line 中文 note on register (哥们儿之间 / 同事之间 / 对老板 / 只在西海岸年轻人里说) and when NOT to use it.
   - "## Sounds off" — if the user wrote English themselves, quote what they wrote and explain in 中文 exactly why it sounds foreign (直译痕迹、过于正式、语序、重音落点), then the fix. Skip this section if they gave you Chinese only.
   - "## Say it out loud" — the single best line rewritten to show real connected speech (e.g. "wanna", "gonna", "lemme", "kinda", "I'mma"), plus which word carries the stress.

Keep it short and usable — a few great lines beat a long list. Explanations in Chinese, the English lines themselves always natural spoken American. Follow-up questions (asking for more options, a different register, "这句太粗鲁了吗", pronunciation, or a practice back-and-forth where you play the other person) are ordinary conversation — just answer directly, and if the user wants to roleplay a scene, stay in character and stay colloquial.`;
    default:
      return "";
  }
}

export const PRESET_IDS = ["english-tutor", "reading-tutor", "vocab-map", "american-speech", "grammar-expert", "writing-coach", "custom"] as const;

/** Pastes longer than this become an attachment chip instead of raw input text */
export const ATTACH_THRESHOLD = 600;

// ── Display types ──────────────────────────────────────────────────────────

export type DisplayItem =
  | { kind: "message"; msg: AiMessage }
  | { kind: "tool_block"; calls: ToolCallDisplay[] };

export function genId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
