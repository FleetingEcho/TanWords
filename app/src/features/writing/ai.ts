import { findBestProvider } from "@/providers/select";
import type { WritingMode, WritingResponse } from "./types";

function systemPrompt(mode: WritingMode, language: "zh" | "en") {
  const responseLanguage = language === "en" ? "English" : "Simplified Chinese";
  const depth = mode === "quick"
    ? "Be concise. Focus on a polished version, a short explanation, at most 3 useful snippets, and at most 4 vocabulary suggestions."
    : "Give a thoughtful free-form analysis. Discuss only relevant grammar, naturalness, wording, structure, logic, or tone. Do not force fixed categories.";
  return `You are a rigorous English writing coach. The user may provide a sentence, paragraph, or essay; never ask them to classify it.
Preserve meaning and facts. ${depth}
Explanations and meanings must be in ${responseLanguage}; keep the user's English and refined English in English.
Candidate originals must be exact excerpts from the input. Vocabulary examples must show how the suggestion works in the user's context.
Return valid JSON only, without markdown fences:
{"refinedText":"","analysis":"","candidates":[{"original":"","refined":"","explanation":""}],"vocabulary":[{"word":"","meaning":"","reason":"","exampleSentence":""}],"modelEssays":[]}`;
}

function parseJson(raw: string): unknown {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

function validate(value: unknown): WritingResponse {
  const v = value as WritingResponse;
  if (!v || typeof v.refinedText !== "string" || typeof v.analysis !== "string") throw new Error("AI response is incomplete");
  v.candidates = Array.isArray(v.candidates) ? v.candidates.filter((item) => item?.original && item?.refined) : [];
  v.vocabulary = Array.isArray(v.vocabulary) ? v.vocabulary.filter((item) => item?.word && item?.meaning) : [];
  v.modelEssays = Array.isArray(v.modelEssays) ? v.modelEssays : [];
  return v;
}

export async function analyzeWriting(text: string, mode: WritingMode, modelEssayCount: number, language: "zh" | "en", signal?: AbortSignal, onProgress?: (raw: string) => void) {
  const provider = findBestProvider();
  if (!provider) throw new Error(language === "en" ? "Configure an AI provider in Settings first" : "请先在设置中配置 AI Provider");
  const essayInstruction = modelEssayCount > 0
    ? `Also create ${modelEssayCount} reference essay(s) on the same topic in modelEssays.`
    : "Return an empty modelEssays array.";
  const request = `${essayInstruction}\n\n${text}`;
  let raw = "";
  for await (const chunk of provider.chat([{ role: "user", content: request }], systemPrompt(mode, language), signal)) {
    raw += chunk;
    onProgress?.(raw);
  }
  return validate(parseJson(raw));
}

export async function generateWritingSummary(source: string, language: "zh" | "en", signal?: AbortSignal) {
  const provider = findBestProvider();
  if (!provider) throw new Error(language === "en" ? "Configure an AI provider in Settings first" : "请先在设置中配置 AI Provider");
  const prompt = `Create a learning summary from only the selected writing records. Cover overall performance, recurring grammar or expression patterns, vocabulary advice, representative examples, and next practice steps. Write in ${language === "en" ? "English" : "Simplified Chinese"}.\n\n${source}`;
  let result = "";
  for await (const chunk of provider.chat([{ role: "user", content: prompt }], "You are an English-writing learning coach. Return clear Markdown.", signal)) result += chunk;
  return result.trim();
}
