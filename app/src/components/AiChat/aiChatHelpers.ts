import { ApiMessage, ContentBlock } from "@/providers/base";
import { ChatSessionItem } from "@/hooks/useDB";
import { AiMessage } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallCard";

// Prompts stay English (they instruct the model); preset names are i18n keys.
export function buildPresetPrompt(presetId: string, targetLevel: string): string {
  switch (presetId) {
    case "english-tutor":
      return `You are an expert English tutor for senior software engineers. The learner's target level is CEFR ${targetLevel} — calibrate vocabulary suggestions and explanations to that level. Help with grammar, vocabulary, idioms, and professional communication. Provide expert-level nuance with tech/business examples. Use Chinese for explanations when helpful. When the user pastes a long article or text and asks you to pull out vocabulary (整理生词/extract vocabulary), call the extract_vocabulary tool yourself with the extracted items rather than listing them in prose — the app renders them as review cards the user can add individually or all at once.`;
    case "grammar-expert":
      return "You are a grammar expert specializing in technical and professional English. Analyze sentences, explain grammatical structures, identify errors, and suggest improvements with clear before/after comparisons. Use Chinese for explanations when helpful.";
    case "writing-coach":
      return "You are a professional writing coach for software engineers. Help improve clarity, conciseness, tone, and impact in emails, docs, and messages. Show rewritten versions and explain improvements. Use Chinese for explanations when helpful.";
    default:
      return "";
  }
}

export const PRESET_IDS = ["english-tutor", "grammar-expert", "writing-coach", "custom"] as const;

/** Pastes longer than this become an attachment chip instead of raw input text */
export const ATTACH_THRESHOLD = 600;

// ── Display types ──────────────────────────────────────────────────────────

export type DisplayItem =
  | { kind: "message"; msg: AiMessage }
  | { kind: "tool_block"; calls: ToolCallDisplay[] };

// ── Date grouping ──────────────────────────────────────────────────────────

type DateGroup = "today" | "yesterday" | "week" | "earlier";

function getGroup(updatedAt: string): DateGroup {
  const now = Date.now();
  const ts = new Date(updatedAt).getTime();
  const d = new Date(updatedAt);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today";
  if (now - ts < 2 * 86400000) return "yesterday";
  if (now - ts < 7 * 86400000) return "week";
  return "earlier";
}

export function groupSessions(sessions: ChatSessionItem[]): [DateGroup, ChatSessionItem[]][] {
  const order: DateGroup[] = ["today", "yesterday", "week", "earlier"];
  const map = new Map<DateGroup, ChatSessionItem[]>();
  for (const s of sessions) {
    const g = getGroup(s.updated_at);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  }
  return order.filter((g) => map.has(g)).map((g) => [g, map.get(g)!]);
}

export function genId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function estimateTokens(items: DisplayItem[]) {
  let chars = 0;
  for (const it of items) {
    if (it.kind === "message") chars += it.msg.content.length;
  }
  return Math.ceil(chars / 4);
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
