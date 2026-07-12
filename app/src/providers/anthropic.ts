import { AIProvider, TranslateParams, ExplainParams, WordEnrichment, buildSystemPrompt, ToolDef, ApiMessage, ToolCallResponse } from "./base";
import { logUsage } from "@/store/usageStore";
import { jsonrepair } from "jsonrepair";

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
    // Prefill assistant turn with "{" — forces model to start JSON immediately,
    // no markdown wrapping or preamble possible.
    let full = "{";
    for await (const chunk of this.streamMessagesMulti(
      system,
      [{ role: "user", content: user }, { role: "assistant", content: "{" }],
      signal,
      maxTokens,
    )) {
      full += chunk;
    }
    logUsage(this.id, this.modelId, inputChars, full.length);
    try { return JSON.parse(full); }
    catch { return JSON.parse(jsonrepair(full)); }
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
