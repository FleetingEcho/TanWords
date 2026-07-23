import { useCallback } from "react";
import { findBestProvider } from "@/providers/select";
import { useDB } from "@/hooks/useDB";
import { useSettingsStore } from "@/store/settingsStore";
import { useAnalysisStore } from "@/store/analysisStore";

function buildSystemPrompt(level: string): string {
  return `You are an English learning assistant for a Chinese native speaker who works in tech (target level: CEFR ${level}). Output ONLY markdown — no commentary about the task itself, no code fences around the whole response.`;
}

function buildPrompt(text: string, knownWords: string[], level: string): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `Read the article below and write a short markdown study note for a ${level} learner. Structure it as:

## Words worth learning
Up to 15 single words worth learning for a ${level} learner, each as one bullet: **word** — 中文释义 — 用法/语气说明（中文，一句话）. Exclude common words (below ${level}), basic tech terms every engineer knows (server, deploy, database...), and proper nouns.

## Sentences worth stealing
3-8 highlight sentences worth imitating — advanced structures, elegant phrasing, rhetorical moves a ${level} learner should steal for their own writing. Prefer sentences that showcase a reusable pattern over merely long ones. Each as a blockquote with the EXACT sentence copied verbatim from the article, followed by a line with 中文翻译 and 这句好在哪、用了什么句式/修辞（中文，1-2句话）.

Rules:
- The user already knows these words, never suggest them again: ${known || "(none listed)"}
- Sentences must be copied verbatim from the article.
- Keep it concise — this is a note to read, not a report.

Article:
"""
${text}
"""`;
}

/** Comments get a different lens than the article body: informal/conversational text is where
 * native idioms, phrasal verbs, and natural discourse patterns actually show up — a formal-prose
 * analysis prompt would mostly find nothing worth extracting there. */
function buildCommentsPrompt(text: string, knownWords: string[], level: string): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `The text below is informal online discussion (Hacker News comments). Write a short markdown study note focused on NATIVE, everyday usage — idioms, phrasal verbs, discourse markers, and natural phrasing a native speaker uses in casual writing that a non-native learner wouldn't naturally produce. Structure it as:

## Words worth learning
Up to 10 words/short phrases worth learning for a ${level} learner, each as one bullet: **word or phrase** — 中文释义 — 地道用法说明：为什么这样说更地道、非母语者容易怎么说得不自然（中文，一句话）.

## Sentences worth stealing
3-6 sentences that showcase natural native phrasing worth imitating in casual writing or speech. Each as a blockquote with the EXACT sentence copied verbatim, followed by a line with 中文翻译 and 这是什么样的口语/网络化表达，母语者为什么会这样说（中文，1-2句话）.

Rules:
- Focus on NATIVE, colloquial usage — NOT formal vocabulary or literary rhetoric (that's a separate pass on the article itself).
- The user already knows these words, never suggest them again: ${known || "(none listed)"}
- Sentences must be copied verbatim from the text.
- Ignore off-topic banter, jokes, or single-word replies with no learning value — skip them rather than forcing something in. If nothing qualifies, write a single line saying so instead of the two headings.
- Keep it concise — this is a note to read, not a report.

Comments:
"""
${text}
"""`;
}

export interface AnalysisResult {
  articleId: number;
  title: string;
}

export function useAnalyzeArticle() {
  const db = useDB();
  // Global rather than local useState: the underlying AI call already keeps running
  // if the caller (e.g. ReadingPage) unmounts mid-analysis — it's just a plain async
  // function, not tied to React lifecycle — but local state wouldn't stay observable
  // once that happens. This makes progress visible from anywhere (see CommandBar).
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const progress = useAnalysisStore((s) => s.progress);

  const analyze = useCallback(
    async (opts: {
      text: string;
      title?: string;
      sourceUrl?: string;
      origin?: string;
      /** Flattened HN comment text, when loaded — run through a separate
       * native/colloquial-usage prompt instead of the article's formal-prose one. */
      commentsText?: string;
    }): Promise<AnalysisResult> => {
      const { start, setProgress, finish } = useAnalysisStore.getState();
      start();
      try {
        const provider = findBestProvider();
        if (!provider) throw new Error("未找到 AI 提供商，请在设置中注册");
        if (!provider.apiKey) throw new Error("未配置 API Key，请在设置 → AI 提供商 中填写");

        const [knownWords, vocab] = await Promise.all([db.getKnownWords(), db.getWords()]);
        const excludeWords = [
          ...new Set([...knownWords.map((w) => w.toLowerCase()), ...vocab.map((w) => w.word.toLowerCase())]),
        ];

        const targetLevel = useSettingsStore.getState().targetLevels.join("/") || "C1";
        let received = 0;
        const runPrompt = async (systemPrompt: string, userPrompt: string): Promise<string> => {
          const chunks: string[] = [];
          for await (const chunk of provider.generate(systemPrompt, userPrompt)) {
            chunks.push(chunk);
            received += chunk.length;
            setProgress(received);
          }
          return chunks.join("").trim();
        };

        const system = buildSystemPrompt(targetLevel);
        let markdown = await runPrompt(system, buildPrompt(opts.text, excludeWords, targetLevel));

        if (opts.commentsText?.trim()) {
          try {
            const commentsMarkdown = await runPrompt(system, buildCommentsPrompt(opts.commentsText, excludeWords, targetLevel));
            markdown += `\n\n---\n\n## From the comments\n\n${commentsMarkdown}`;
          } catch {
            // The comments pass is a bonus — a flaky/short response there shouldn't sink the whole Learn action.
          }
        }

        const title = opts.title?.trim() || "Untitled";
        const articleId = await db.saveArticleAnalysis(
          title,
          opts.sourceUrl ?? "",
          opts.origin ?? "pasted",
          opts.text,
          markdown
        );
        return { articleId, title };
      } catch (e: any) {
        if (e.message === "Load failed" || e.message === "Failed to fetch") {
          throw new Error("网络请求失败。请检查 API Key 与网络连接");
        }
        throw e;
      } finally {
        finish();
      }
    },
    [db]
  );

  return { analyze, isAnalyzing, progress };
}
