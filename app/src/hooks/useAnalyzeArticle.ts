import { useCallback, useState } from "react";
import { jsonrepair } from "jsonrepair";
import { findBestProvider } from "@/providers/select";
import { useDB, NewExtractedItem } from "@/hooks/useDB";
import { useSettingsStore } from "@/store/settingsStore";

function buildSystemPrompt(level: string): string {
  return `You are an English learning assistant for a Chinese native speaker who works in tech (target level: CEFR ${level}). Output ONLY valid JSON, no markdown, no code fences, no commentary.`;
}

function buildPrompt(text: string, knownWords: string[], level: string): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `Analyze the article below and extract learning material. Return ONLY this JSON:
{"title":"a short title for the article (keep original if obvious)","words":[{"text":"word","zh":"中文释义","level":"C1|C2","note":"用法/语气说明（中文，一句话）","context":"the EXACT sentence from the article containing it"}],"sentences":[{"text":"the EXACT sentence copied verbatim from the article","zh":"中文翻译","note":"这句好在哪、用了什么句式/修辞（中文，1-2句话）","pattern":"可复用的句式骨架，如 'not so much X as Y'"}]}

Rules:
- "words": up to 15 single words worth learning for a ${level} learner. EXCLUDE: common words (below ${level}), basic tech terms every engineer knows (server, deploy, database...), proper nouns.
- "sentences": 3-8 highlight sentences worth imitating — advanced structures, elegant phrasing, rhetorical moves a ${level} learner should steal for their own writing. Prefer sentences that showcase a REUSABLE pattern over merely long ones.
- The user already knows these words, never include them: ${known || "(none listed)"}
- "context" and sentence "text" must be copied verbatim from the article.

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
        const targetLevel = useSettingsStore.getState().targetLevels.join("/") || "C1";
        for await (const chunk of provider.generate(
          buildSystemPrompt(targetLevel),
          buildPrompt(opts.text, knownWords, targetLevel)
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
        for (const s of parsed.sentences ?? []) {
          if (!s?.text) continue;
          items.push({
            kind: "sentence",
            text: String(s.text),
            zh: String(s.zh ?? ""),
            note: String(s.note ?? ""),
            level: "",
            // For sentence items the sentence IS the text — reuse the context
            // column for the reusable pattern skeleton instead.
            context: String(s.pattern ?? ""),
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
