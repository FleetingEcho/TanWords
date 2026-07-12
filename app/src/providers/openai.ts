import { AIProvider, TranslateParams, ExplainParams, WordEnrichment, buildSystemPrompt, ToolDef, ApiMessage, ToolCallResponse, ContentBlock } from "./base";
import { logUsage } from "@/store/usageStore";
import { jsonrepair } from "jsonrepair";

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

  async *enrich(word: string, signal?: AbortSignal): AsyncGenerator<Partial<WordEnrichment>> {
    const queue: Partial<WordEnrichment>[] = [];
    const waiters: Array<() => void> = [];

    // Slice 1: definitions + level
    this.fetchJSON(
      "You are a lexicographer. Output ONLY valid JSON, no markdown, no code fences.",
      `For the English word "${word}", return ONLY this JSON:
{"definitions":[{"pos":"adj|v|n|adv","zh":"中文","en":"English def","exampleEn":"example sentence","exampleZh":"中文例句"}],"level":"C1"}
Include all major parts of speech. Be thorough.`,
      800, signal
    ).then((d) => queue.push({ definitions: d.definitions || [], level: d.level || "B2" }), () => queue.push({}))
     .finally(() => waiters.shift()?.());

    // Slice 2: synonyms + antonyms + collocations + derivatives
    this.fetchJSON(
      "You are a lexicographer. Output ONLY valid JSON, no markdown, no code fences.",
      `For the English word "${word}", return ONLY this JSON:
{"synonyms":[{"word":"syn","note":"nuance diff in English","noteZh":"与原词的区别（中文说明）"}],"antonyms":["ant1"],"collocations":["phrase1"],"derivatives":[{"word":"deriv","wordType":"n|adj|v","zh":"中文"}]}
Provide at least 3 synonyms, all antonyms, at least 4 collocations, all common derivatives.`,
      800, signal
    ).then((r) => queue.push({ synonyms: r.synonyms || [], antonyms: r.antonyms || [], collocations: r.collocations || [], derivatives: r.derivatives || [] }), () => queue.push({}))
     .finally(() => waiters.shift()?.());

    // Slice 3a: sentence patterns + idioms
    this.fetchJSON(
      "You are a lexicographer. Output ONLY valid JSON, no markdown, no code fences.",
      `For the English word "${word}", return ONLY this JSON:
{"sentencePatterns":[{"pattern":"V + obj","explanation":"说明","example":"example"}],"idioms":[{"idiom":"idiom phrase","explanation":"解释","example":"example sentence"}]}
Include all major sentence patterns and any common idioms.`,
      600, signal
    ).then((u) => queue.push({ sentencePatterns: u.sentencePatterns || [], idioms: u.idioms || [] }), () => queue.push({}))
     .finally(() => waiters.shift()?.());

    // Slice 3b: mnemonic + example sentences + etymology
    this.fetchJSON(
      "You are a lexicographer. Output ONLY valid JSON, no markdown, no code fences.",
      `For the English word "${word}", return ONLY this JSON:
{"mnemonic":"记忆口诀","sentences":[{"text":"a natural, high-quality English sentence using this word","label":"casual|formal|technical|business"}],"etymology":{"parts":[{"seg":"root","role":"prefix|root|suffix","meaning":"meaning"}],"story":"etymology story","originLang":"Latin|Greek"}}
Provide at least 4 varied example sentences in different registers.`,
      700, signal
    ).then((u) => queue.push({ mnemonic: u.mnemonic || "", sentences: u.sentences || [], etymology: u.etymology || { parts: [], story: "", originLang: "" } }), () => queue.push({}))
     .finally(() => waiters.shift()?.());

    // Yield 4 results as they arrive
    let yielded = 0;
    while (yielded < 4) {
      if (signal?.aborted) return;
      if (yielded < queue.length) {
        yield queue[yielded++];
      } else {
        await new Promise<void>((r) => {
          waiters.push(r);
          signal?.addEventListener("abort", () => r(), { once: true });
        });
      }
    }
  }

  private async fetchJSON(
    system: string,
    user: string,
    maxTokens: number,
    signal?: AbortSignal,
  ): Promise<any> {
    const inputChars = system.length + user.length;
    let full = "";
    for await (const chunk of this.streamChat([
      { role: "system", content: system },
      { role: "user", content: user },
    ], signal, maxTokens, true)) {
      full += chunk;
    }
    logUsage(this.id, this.modelId, inputChars, full.length);
    try { return JSON.parse(full); }
    catch { return JSON.parse(jsonrepair(full)); }
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
