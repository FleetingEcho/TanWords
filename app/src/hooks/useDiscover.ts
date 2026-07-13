import { useCallback, useState } from "react";
import { jsonrepair } from "jsonrepair";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";

export interface GeneratedWord {
  word: string;
  zh: string;
  ipa: string;
  level: string;
  example: string;
}

export interface FamilyWord {
  word: string;
  zh: string;
  level: string;
  breakdown: string;
}

export interface WordFamily {
  root: string;
  meaning: string;
  words: FamilyWord[];
}

/** Pull the first JSON array/object out of model output, repairing minor damage
 *  (trailing commas, unclosed brackets, stray prose) instead of regex-and-pray. */
function parseModelJson<T>(raw: string, opener: "[" | "{"): T {
  const start = raw.indexOf(opener);
  if (start === -1) throw new Error("No JSON in model output");
  const candidate = raw.slice(start);
  return JSON.parse(jsonrepair(candidate)) as T;
}

export function useDiscover() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingFamily, setIsGeneratingFamily] = useState(false);
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  const generateTopicVocabulary = useCallback(
    async (topic: string, count: number = 50, excludeWords: string[] = []): Promise<GeneratedWord[]> => {
      setIsGenerating(true);
      try {
        const provider = findBestProvider();
        if (!provider) throw new Error("未配置 AI 提供商，请在设置 → AI 提供商 中填写");

        const systemPrompt =
          "You are a vocabulary expert. Output ONLY a valid JSON array, no other text, no markdown, no code fences.";

        // Capped to keep prompt size sane for large vocabularies — a partial
        // exclude list still meaningfully cuts down repeats from the model.
        const excludeClause = excludeWords.length > 0
          ? `\nThe learner already knows these words — do NOT include any of them: ${excludeWords.slice(0, 200).join(", ")}.`
          : "";

        const userPrompt = `Generate ${count} English vocabulary words related to the topic "${topic}".
Return a JSON array where each element is:
{"word": "...", "zh": "中文释义", "ipa": "/phonetic/", "level": "B2|C1|C2", "example": "Example sentence using the word in a ${topic} context."}
${excludeClause}
The learner's level is CEFR ${targetLevel} — pick words at or slightly above that level that are actually used in ${topic} contexts. Return ONLY the JSON array.`;

        const chunks: string[] = [];
        for await (const chunk of provider.generate(systemPrompt, userPrompt)) {
          chunks.push(chunk);
        }
        return parseModelJson<GeneratedWord[]>(chunks.join(""), "[");
      } catch (e: any) {
        if (e.message === "Load failed" || e.message === "Failed to fetch") {
          throw new Error("网络请求失败。请检查：1) API Key 是否正确 2) 网络是否正常 3) API 服务是否可访问");
        }
        throw e;
      } finally {
        setIsGenerating(false);
      }
    },
    [targetLevel]
  );

  const generateWordFamily = useCallback(
    async (root: string): Promise<WordFamily> => {
      setIsGeneratingFamily(true);
      try {
        const provider = findBestProvider();
        if (!provider) throw new Error("未配置 AI 提供商，请在设置 → AI 提供商 中填写");

        const systemPrompt =
          "You are an etymology expert. Output ONLY a valid JSON object, no other text, no markdown, no code fences.";

        const userPrompt = `For the English root/prefix/suffix "${root}", return its word family as JSON:
{"root": "${root}", "meaning": "词根含义（中文）", "words": [{"word": "...", "zh": "中文释义", "level": "B1|B2|C1|C2", "breakdown": "词根拆解, e.g. in-(into) + spect(look)"}]}

Include 6-12 genuinely common words built on this root, ordered from most to least common. The learner is CEFR ${targetLevel}. Return ONLY the JSON object.`;

        const chunks: string[] = [];
        for await (const chunk of provider.generate(systemPrompt, userPrompt)) {
          chunks.push(chunk);
        }
        return parseModelJson<WordFamily>(chunks.join(""), "{");
      } catch (e: any) {
        if (e.message === "Load failed" || e.message === "Failed to fetch") {
          throw new Error("网络请求失败。请检查 API Key 与网络后重试");
        }
        throw e;
      } finally {
        setIsGeneratingFamily(false);
      }
    },
    [targetLevel]
  );

  const generateTopicSuggestions = useCallback(
    async (): Promise<string[]> => {
      const provider = findBestProvider();
      if (!provider) throw new Error("未配置 AI 提供商，请在设置 → AI 提供商 中填写");

      const systemPrompt =
        "You are a vocabulary curriculum designer. Output ONLY a valid JSON array of strings, no other text, no markdown, no code fences.";
      const userPrompt = `Suggest 9 diverse, useful topic categories for generating English vocabulary batches for a CEFR ${targetLevel} learner. Cover a good mix of technical, business, science, humanities, and everyday-life domains. Return ONLY a JSON array of short topic name strings (English, Title Case, 1-3 words each, e.g. "System Design", "Behavioral Economics"). Pick a genuinely different, varied set each time — do not default to only the most obvious/common categories.`;

      const chunks: string[] = [];
      for await (const chunk of provider.generate(systemPrompt, userPrompt)) chunks.push(chunk);
      return parseModelJson<string[]>(chunks.join(""), "[");
    },
    [targetLevel]
  );

  const generateRootSuggestions = useCallback(
    async (): Promise<string[]> => {
      const provider = findBestProvider();
      if (!provider) throw new Error("未配置 AI 提供商，请在设置 → AI 提供商 中填写");

      const systemPrompt =
        "You are an etymology expert. Output ONLY a valid JSON array of strings, no other text, no markdown, no code fences.";
      const userPrompt = `Suggest 8 diverse, genuinely useful English roots/prefixes/suffixes for a word-family explorer, in hyphenated notation (e.g. "-spect", "bene-", "trans-"). Mix Latin and Greek origins, and mix prefixes/suffixes/roots. Return ONLY a JSON array of strings. Pick a varied set each time — do not always default to the same most-common handful.`;

      const chunks: string[] = [];
      for await (const chunk of provider.generate(systemPrompt, userPrompt)) chunks.push(chunk);
      return parseModelJson<string[]>(chunks.join(""), "[");
    },
    [targetLevel]
  );

  return {
    generateTopicVocabulary,
    generateWordFamily,
    generateTopicSuggestions,
    generateRootSuggestions,
    isGenerating,
    isGeneratingFamily,
  };
}
