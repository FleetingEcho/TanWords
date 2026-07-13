import { AIProvider, TranslateParams, ExplainParams, buildSystemPrompt, buildEnrichSystemPrompt, buildEnrichUserPrompt, ToolDef, ApiMessage, ToolCallResponse } from "./base";
import { logUsage } from "@/store/usageStore";
import { useSettingsStore } from "@/store/settingsStore";

export class AnthropicProvider implements AIProvider {
  id = "claude";
  name = "Anthropic Claude";
  isCustom = false;

  constructor(
    public apiBase: string = "https://api.anthropic.com",
    public apiKey: string = "",
    public modelId: string = "claude-haiku-4-5"
  ) {}

  async *translate(params: TranslateParams): AsyncGenerator<string> {
    const systemPrompt = buildSystemPrompt(params.mode);
    const userPrompt = params.sourceLang
      ? `Translate from ${params.sourceLang} to ${params.targetLang}:\n\n${params.text}`
      : `Translate to ${params.targetLang}:\n\n${params.text}`;
    yield* this.streamMessages(systemPrompt, userPrompt);
  }

  async *explain(params: ExplainParams): AsyncGenerator<string> {
    yield* this.streamMessages(
      "You are a grammar expert. Explain the grammar and sentence structure in detail.",
      params.text
    );
  }

  async *enrich(word: string, signal?: AbortSignal): AsyncGenerator<string> {
    const { targetLevels, customEnrichPrompt } = useSettingsStore.getState();
    const targetLevel = targetLevels.join("/");
    const system = buildEnrichSystemPrompt(customEnrichPrompt);
    const user = buildEnrichUserPrompt(word, targetLevel);
    const inputChars = system.length + user.length;
    let full = "";
    for await (const chunk of this.streamMessages(system, user, signal)) {
      full += chunk;
      yield chunk;
    }
    logUsage(this.id, this.modelId, inputChars, full.length);
  }

  async *generate(systemPrompt: string, userPrompt: string): AsyncGenerator<string> {
    yield* this.streamMessages(systemPrompt, userPrompt);
  }

  async *chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    yield* this.streamMessagesMulti(systemPrompt, messages, signal);
  }

  private async *streamMessagesMulti(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    signal?: AbortSignal,
    maxTokens?: number,
  ): AsyncGenerator<string> {
    const response = await fetch(`${this.apiBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: this.modelId, system, messages, max_tokens: maxTokens || 4096, stream: true }),
      signal,
    });
    if (!response.ok) { const err = await response.text(); throw new Error(`Anthropic API error: ${response.status} - ${err}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "content_block_delta" && parsed.delta?.text) yield parsed.delta.text;
          } catch {}
        }
      }
    } finally { reader.releaseLock(); }
  }

  async chatWithTools(
    messages: ApiMessage[],
    systemPrompt: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    onText?: (chunk: string) => void,
  ): Promise<ToolCallResponse> {
    const response = await fetch(`${this.apiBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelId,
        system: systemPrompt,
        messages,
        tools,
        max_tokens: 4096,
        stream: true,
      }),
      signal,
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic ${response.status}: ${err}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";

    let textContent = "";
    const toolCalls: ToolCallResponse["toolCalls"] = [];
    type Block =
      | { type: "text" }
      | { type: "tool_use"; id: string; name: string; inputJson: string };
    const blocks: Record<number, Block> = {};
    let stopReason: ToolCallResponse["stopReason"] = "end_turn";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.type === "content_block_start") {
              if (p.content_block?.type === "text") {
                blocks[p.index] = { type: "text" };
              } else if (p.content_block?.type === "tool_use") {
                blocks[p.index] = { type: "tool_use", id: p.content_block.id, name: p.content_block.name, inputJson: "" };
              }
            } else if (p.type === "content_block_delta") {
              const b = blocks[p.index];
              if (!b) continue;
              if (b.type === "text" && p.delta?.type === "text_delta") {
                textContent += p.delta.text;
                onText?.(p.delta.text);
              } else if (b.type === "tool_use" && p.delta?.type === "input_json_delta") {
                b.inputJson += p.delta.partial_json ?? "";
              }
            } else if (p.type === "content_block_stop") {
              const b = blocks[p.index];
              if (b?.type === "tool_use") {
                try { toolCalls.push({ id: b.id, name: b.name, input: JSON.parse(b.inputJson || "{}") }); } catch {}
              }
            } else if (p.type === "message_delta" && p.delta?.stop_reason === "tool_use") {
              stopReason = "tool_use";
            }
          } catch {}
        }
      }
    } finally { reader.releaseLock(); }

    return { textContent, toolCalls, stopReason };
  }

  private async *streamMessages(
    system: string,
    userMessage: string,
    signal?: AbortSignal,
    maxTokens?: number
  ): AsyncGenerator<string> {
    const body: any = {
      model: this.modelId,
      system,
      messages: [{ role: "user", content: userMessage }],
      stream: true,
    };
    body.max_tokens = maxTokens || 4096;

    const response = await fetch(`${this.apiBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) { const err = await response.text(); throw new Error(`Anthropic API error: ${response.status} - ${err}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.type === "content_block_delta" && parsed.delta?.text) yield parsed.delta.text;
          } catch {}
        }
      }
    } finally { reader.cancel(); }
  }
}
