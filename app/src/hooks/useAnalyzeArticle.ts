import { useCallback } from "react";
import { findBestProvider } from "@/providers/select";
import { useDB } from "@/hooks/useDB";
import { useAnalysisStore } from "@/store/analysisStore";

function buildSystemPrompt(): string {
  return `You are an English reading tutor for a Chinese native speaker. Create practical, substantial study notes grounded in the source text. Output ONLY markdown — no commentary about the task itself and no code fences around the whole response. Do not mention or classify content by CEFR or any other proficiency framework.`;
}

function buildPrompt(text: string, knownWords: string[]): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `Read the article below and create a useful markdown study note in Chinese. Use exactly these sections:

## 文章大意
A clear, simple summary of the article in Chinese, about 3-5 sentences. Explain the main argument, key supporting points, and conclusion without turning this into a long report.

## 值得学习的词汇
Select 20-30 useful words or short phrases from the article. Include collocations and phrasal verbs when useful. Each item must be one concise bullet in this format: **word or phrase** — 简单中文释义. Do not add CEFR labels, usage essays, source-context columns, or a table.

## 亮点句子
Select 5-10 complete sentences worth rereading or imitating because they are clear, elegant, persuasive, or memorable. For each item:
> Copy the exact complete English sentence from the article.

Then give its Chinese translation and one short Chinese sentence explaining why it is effective.

## 亮点句型
Extract 4-8 reusable sentence patterns demonstrated by the article. For each item, show:
- the reusable English pattern with replaceable parts in brackets;
- the exact source sentence that demonstrates it;
- a short Chinese explanation of when or how to use it.

## 地道表达
Select 6-12 natural collocations, idiomatic phrases, phrasal verbs, or rhetorical expressions from the article that a native speaker would naturally use. Each as one bullet: **expression** — 简单中文意思；简短说明它在原文中的语气或用法.

Rules:
- The user already knows these words; do not include them in the vocabulary section: ${known || "(none listed)"}
- Every quoted sentence and expression must actually occur in the article. Never invent or silently rewrite a quote.
- Prefer broadly useful English over proper nouns, product names, and basic technical terms.
- Keep explanations concise, but provide every requested section and do not make the note sparse.
- Do not include CEFR levels or proficiency classifications anywhere.

Article:
"""
${text}
"""`;
}

/** Comments get a different lens than the article body: informal/conversational text is where
 * native idioms, phrasal verbs, and natural discourse patterns actually show up — a formal-prose
 * analysis prompt would mostly find nothing worth extracting there. */
function buildCommentsPrompt(text: string, knownWords: string[]): string {
  const known = knownWords.slice(0, 150).join(", ");
  return `The text below is informal online discussion (Hacker News comments). Create a concise Chinese supplement focused on native, everyday usage — idioms, phrasal verbs, discourse markers, and natural phrasing a non-native speaker may not naturally produce. Structure it as:

## 评论区地道表达
Select 6-12 useful words or short expressions. Each as one bullet: **word or expression** — 简单中文意思；一句简短的地道用法说明.

## 评论区亮点句子
Select 3-6 complete sentences that showcase natural phrasing worth imitating in casual writing or speech. Copy each exact sentence as a blockquote, then give a Chinese translation and one short explanation.

Rules:
- Focus on native, colloquial usage rather than formal vocabulary or literary rhetoric.
- The user already knows these words, never suggest them again: ${known || "(none listed)"}
- Sentences must be copied verbatim from the text.
- Ignore off-topic banter, jokes, or single-word replies with no learning value — skip them rather than forcing something in. If nothing qualifies, write a single line saying so instead of the two headings.
- Do not include CEFR levels or proficiency classifications.

Comments:
"""
${text}
"""`;
}

export interface AnalysisResult {
  articleId: number;
  title: string;
  markdown: string;
}

export function useAnalyzeArticle() {
  const db = useDB();
  // Global rather than local useState: the underlying AI call already keeps running
  // if the caller (e.g. ArticleReader) unmounts mid-analysis — it's just a plain async
  // function, not tied to React lifecycle — but local state wouldn't stay observable
  // once that happens. This makes progress visible from anywhere (see CommandBar).
  // Each call gets its own job id, so several can run concurrently (e.g. a few
  // queued from the Feeds list in the background) without clobbering each
  // other's progress — `isAnalyzing`/`progress` here just reflect "is anything
  // running" / "the most recently updated job", for simple single-job UI.
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
      /** Set for entries from Hacker News (or hnrss-style feeds) — saved alongside the
       * lesson so it can show the original discussion thread, not just its analysis. */
      hnItemId?: number | null;
    }): Promise<AnalysisResult> => {
      const jobId = crypto.randomUUID();
      const controller = new AbortController();
      const { start, setProgress, finish } = useAnalysisStore.getState();
      start(jobId, opts.title?.trim() || "Untitled", controller);
      try {
        const provider = findBestProvider();
        // findBestProvider only returns a provider that can attempt calls
        // (a keyless self-hosted server included), so null is the only
        // thing to guard against here.
        if (!provider) throw new Error("未找到可用的 AI 提供商，请在设置 → AI 提供商 中添加");

        const [knownWords, vocab] = await Promise.all([db.getKnownWords(), db.getWords()]);
        const excludeWords = [
          ...new Set([...knownWords.map((w) => w.toLowerCase()), ...vocab.map((w) => w.word.toLowerCase())]),
        ];

        let received = 0;
        const runPrompt = async (systemPrompt: string, userPrompt: string): Promise<string> => {
          const chunks: string[] = [];
          for await (const chunk of provider.generate(systemPrompt, userPrompt, controller.signal)) {
            chunks.push(chunk);
            received += chunk.length;
            setProgress(jobId, received);
          }
          return chunks.join("").trim();
        };

        const system = buildSystemPrompt();
        let markdown = await runPrompt(system, buildPrompt(opts.text, excludeWords));

        if (opts.commentsText?.trim()) {
          try {
            const commentsMarkdown = await runPrompt(system, buildCommentsPrompt(opts.commentsText, excludeWords));
            markdown += `\n\n---\n\n## From the comments\n\n${commentsMarkdown}`;
          } catch (e: any) {
            // The comments pass is a bonus — a flaky/short response there shouldn't sink the whole
            // Learn action. A cancellation is different: it means the whole job should stop, not
            // silently save an article-only result as if nothing happened.
            if (e?.name === "AbortError") throw e;
          }
        }

        const title = opts.title?.trim() || "Untitled";
        const articleId = await db.saveArticleAnalysis(
          title,
          opts.sourceUrl ?? "",
          opts.origin ?? "pasted",
          opts.text,
          markdown,
          opts.hnItemId ?? null
        );
        return { articleId, title, markdown };
      } catch (e: any) {
        if (e.message === "Load failed" || e.message === "Failed to fetch") {
          throw new Error("网络请求失败。请检查 API Key 与网络连接");
        }
        throw e;
      } finally {
        finish(jobId);
      }
    },
    [db]
  );

  return { analyze, isAnalyzing, progress };
}
