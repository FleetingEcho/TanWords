import { AIProvider, TranslateParams, ExplainParams, buildSystemPrompt, buildEnrichSystemPrompt, buildEnrichUserPrompt, ToolDef, ApiMessage, ToolCallResponse, ContentBlock } from "./base";
import { logUsage } from "@/store/usageStore";
import { useSettingsStore } from "@/store/settingsStore";

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI";
  isCustom = false;

  constructor(
    public apiBase: string = "https://api.openai.com/v1",
    public apiKey: string = "",
    public modelId: string = "gpt-4o-mini"
  ) {}

  async *translate(params: TranslateParams): AsyncGenerator<string> {
    const systemPrompt = buildSystemPrompt(params.mode);
    const userPrompt = params.sourceLang
      ? `Translate from ${params.sourceLang} to ${params.targetLang}:\n\n${params.text}`
      : `Translate to ${params.targetLang}:\n\n${params.text}`;
    yield* this.streamChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  }

  async *explain(params: ExplainParams): AsyncGenerator<string> {
    yield* this.streamChat([
      { role: "system", content: "You are a grammar expert. Explain the grammar and sentence structure of the given text in detail." },
      { role: "user", content: params.text },
    ]);
  }

  async *enrich(word: string, signal?: AbortSignal): AsyncGenerator<string> {
    const { targetLevels, customEnrichPrompt } = useSettingsStore.getState();
    const targetLevel = targetLevels.join("/");
    const system = buildEnrichSystemPrompt(customEnrichPrompt);
    const user = buildEnrichUserPrompt(word, targetLevel);
    const inputChars = system.length + user.length;
    let full = "";
    for await (const chunk of this.streamChat([
      { role: "system", content: system },
      { role: "user", content: user },
    ], signal)) {
      full += chunk;
      yield chunk;
    }
    logUsage(this.id, this.modelId, inputChars, full.length);
  }

  async *generate(systemPrompt: string, userPrompt: string): AsyncGenerator<string> {
    yield* this.streamChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  }

  async *chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    systemPrompt: string,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    yield* this.streamChat(
      [{ role: "system", content: systemPrompt }, ...messages],
      signal
    );
  }

  async chatWithTools(
    messages: ApiMessage[],
    systemPrompt: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    onText?: (chunk: string) => void,
  ): Promise<ToolCallResponse> {
    // Convert ApiMessage[] (Anthropic-style) to OpenAI format
    const oaiMessages: any[] = [{ role: "system", content: systemPrompt }];
    for (const m of messages) {
      if (typeof m.content === "string") {
        oaiMessages.push({ role: m.role, content: m.content });
        continue;
      }
      const blocks = m.content as ContentBlock[];
      if (m.role === "assistant") {
        const textPart = blocks.filter(b => b.type === "text").map(b => (b as any).text).join("");
        const tcPart = blocks.filter(b => b.type === "tool_use").map(b => {
          const tb = b as any;
          return { id: tb.id, type: "function", function: { name: tb.name, arguments: JSON.stringify(tb.input) } };
        });
        oaiMessages.push({ role: "assistant", content: textPart || null, tool_calls: tcPart.length ? tcPart : undefined });
      } else {
        // user turn with tool_result blocks → separate "tool" messages
        for (const b of blocks) {
          if (b.type === "tool_result") {
            oaiMessages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
          }
        }
      }
    }

    const oaiTools = tools.map(t => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.modelId, messages: oaiMessages, tools: oaiTools, stream: true }),
      signal,
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI ${response.status}: ${err}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";

    let textContent = "";
    const partialToolCalls: Record<number, { id: string; name: string; argsJson: string }> = {};
    let stopReason: ToolCallResponse["stopReason"] = "end_turn";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const p = JSON.parse(data);
            const delta = p.choices?.[0]?.delta;
            const finishReason = p.choices?.[0]?.finish_reason;
            if (delta?.content) { textContent += delta.content; onText?.(delta.content); }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!partialToolCalls[tc.index]) {
                  partialToolCalls[tc.index] = { id: tc.id ?? "", name: tc.function?.name ?? "", argsJson: "" };
                }
                if (tc.id) partialToolCalls[tc.index].id = tc.id;
                if (tc.function?.name) partialToolCalls[tc.index].name = tc.function.name;
                partialToolCalls[tc.index].argsJson += tc.function?.arguments ?? "";
              }
            }
            if (finishReason === "tool_calls") stopReason = "tool_use";
          } catch {}
        }
      }
    } finally { reader.cancel(); }

    const toolCalls = Object.values(partialToolCalls).map(tc => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.argsJson || "{}"); } catch {}
      return { id: tc.id, name: tc.name, input };
    });

    return { textContent, toolCalls, stopReason };
  }

  private async *streamChat(
    messages: { role: string; content: string }[],
    signal?: AbortSignal,
    maxTokens?: number,
    jsonMode?: boolean
  ): AsyncGenerator<string> {
    const body: any = { model: this.modelId, messages, stream: true };
    if (maxTokens) body.max_tokens = maxTokens;
    if (jsonMode) body.response_format = { type: "json_object" };

    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }
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
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {}
        }
      }
    } finally { reader.cancel(); }
  }
}
