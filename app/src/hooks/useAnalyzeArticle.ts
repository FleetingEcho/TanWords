import { useCallback, useState } from "react";
import { jsonrepair } from "jsonrepair";
import { findBestProvider } from "@/providers/select";
import { useDB, NewExtractedItem } from "@/hooks/useDB";

const SYSTEM_PROMPT =
  "You are an English learning assistant for a Chinese native speaker who works in tech and has IELTS 7 (CEFR C1). Output ONLY valid JSON, no markdown, no code fences, no commentary.";

function buildPrompt(text: string, knownWords: string[]): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `Analyze the article below and extract learning material. Return ONLY this JSON:
{"title":"a short title for the article (keep original if obvious)","words":[{"text":"word","zh":"中文释义","level":"C1|C2","note":"用法/语气说明（中文，一句话）","context":"the EXACT sentence from the article containing it"}],"patterns":[{"text":"the expression, collocation or sentence pattern","zh":"中文意思","note":"什么场合用、为什么地道（中文，一句话）","context":"the EXACT sentence from the article"}]}

Rules:
- "words": up to 15 single words worth learning for a C1 learner. EXCLUDE: common words (below C1), basic tech terms every engineer knows (server, deploy, database...), proper nouns.
- "patterns": up to 8 idiomatic expressions, strong collocations, or sentence patterns that are useful in professional/tech writing.
- The user already knows these words, never include them: ${known || "(none listed)"}
- "context" must be copied verbatim from the article.

Article:
"""
${text}
"""`;
}

export interface AnalysisResult {
  articleId: number;
  itemCount: number;
  title: string;
}

export function useAnalyzeArticle() {
  const db = useDB();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  const analyze = useCallback(
    async (opts: {
      text: string;
      title?: string;
      sourceUrl?: string;
      origin?: string;
    }): Promise<AnalysisResult> => {
      setIsAnalyzing(true);
      setProgress(0);
      try {
        const provider = findBestProvider();
        if (!provider) throw new Error("未找到 AI 提供商，请在设置中注册");
        if (!provider.apiKey) throw new Error("未配置 API Key，请在设置 → AI 提供商 中填写");

        const [knownWords, vocab] = await Promise.all([db.getKnownWords(), db.getWords()]);
        const excludeSet = new Set<string>([
          ...knownWords.map((w) => w.toLowerCase()),
          ...vocab.map((w) => w.word.toLowerCase()),
        ]);

        const chunks: string[] = [];
        let received = 0;
        for await (const chunk of provider.generate(
          SYSTEM_PROMPT,
          buildPrompt(opts.text, knownWords)
        )) {
          chunks.push(chunk);
          received += chunk.length;
          setProgress(received);
        }
        const raw = chunks.join("");

        let parsed: any;
        const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
        try {
          parsed = JSON.parse(json);
        } catch {
          parsed = JSON.parse(jsonrepair(json));
        }

        const items: NewExtractedItem[] = [];
        for (const w of parsed.words ?? []) {
          if (!w?.text) continue;
          if (excludeSet.has(String(w.text).toLowerCase())) continue;
          items.push({
            kind: "word",
            text: String(w.text),
            zh: String(w.zh ?? ""),
            note: String(w.note ?? ""),
            level: String(w.level ?? ""),
            context: String(w.context ?? ""),
          });
        }
        for (const p of parsed.patterns ?? []) {
          if (!p?.text) continue;
          items.push({
            kind: "pattern",
            text: String(p.text),
            zh: String(p.zh ?? ""),
            note: String(p.note ?? ""),
            level: "",
            context: String(p.context ?? ""),
          });
        }

        const title = opts.title?.trim() || String(parsed.title ?? "").trim() || "Untitled";
        const articleId = await db.saveArticleAnalysis(
          title,
          opts.sourceUrl ?? "",
          opts.origin ?? "pasted",
          opts.text,
          items
        );
        return { articleId, itemCount: items.length, title };
      } catch (e: any) {
        if (e.message === "Load failed" || e.message === "Failed to fetch") {
          throw new Error("网络请求失败。请检查 API Key 与网络连接");
        }
        throw e;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [db]
  );

  return { analyze, isAnalyzing, progress };
}
