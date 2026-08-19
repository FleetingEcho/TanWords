import { useCallback } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { useLearnChatStore } from "@/store/learnChatStore";
import {
  buildArticleBody, buildPresetPrompt, genId, isContextOverflowError, serializeItems, unwrapMarkdownFence, type DisplayItem,
} from "@/components/AiChat/aiChatHelpers";

/** Runs the same Reading Tutor exchange as manually pasting an article into AI
 *  Chat (`useAiChatSession.startWithArticle`) — same preset prompt, same tools
 *  — but headless: no page navigation, no streaming UI, and the promise keeps
 *  running after the caller unmounts. Progress is tracked in `learnChatStore`
 *  keyed by article URL; the result is saved as an ordinary chat session via
 *  `db.upsertChatSession`, ready to open in AI Chat like any other. */
export function useLearnArticle() {
  const db = useDB();
  const t = useT();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  const startLearn = useCallback(
    (articleUrl: string, article: { title: string; text: string; commentsText?: string }) => {
      const store = useLearnChatStore.getState();
      if (store.jobs[articleUrl]?.status === "running") return;

      const provider = findBestProvider();
      if (!provider) {
        toast.error(t("aichat.noProvider"));
        return;
      }

      const controller = new AbortController();
      const sessionId = genId();
      const fallbackTitle = article.title.slice(0, 50) + (article.title.length > 50 ? "…" : "");
      store.start(articleUrl, controller, sessionId);
      // Placeholder until the known-words fetch below resolves — reassigned before
      // runExchange/persistTranscript are ever actually called, same personalization
      // useAnalyzeArticle's Notes prompt already applies.
      let sysPrompt = buildPresetPrompt("reading-tutor", targetLevel);

      // Neither streaming call below has a per-chunk-arrival deadline, so a
      // provider that stops emitting mid-response (without ever closing the
      // connection) would otherwise leave the job stuck on "running" forever
      // — no toast, no error, and the reader bar's spinner never clears. Any
      // gap this long between chunks aborts the shared controller, which
      // unwinds the same way a real Cancel click does.
      const STALL_TIMEOUT_MS = 45_000;
      let stalled = false;
      let watchdog: number | undefined;
      const armWatchdog = () => {
        if (watchdog !== undefined) window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => { stalled = true; controller.abort(); }, STALL_TIMEOUT_MS);
      };
      const disarmWatchdog = () => {
        if (watchdog !== undefined) { window.clearTimeout(watchdog); watchdog = undefined; }
      };

      const persistTranscript = async (userText: string, assistantText: string, title = fallbackTitle) => {
        const items: DisplayItem[] = [
          { kind: "message", msg: { role: "user", content: userText } },
          ...(assistantText
            ? [{ kind: "message" as const, msg: { role: "assistant" as const, content: assistantText } }]
            : []),
        ];
        await db.upsertChatSession({
          id: sessionId,
          title,
          messages: serializeItems(items),
          systemPrompt: sysPrompt,
          presetId: "reading-tutor",
          providerId: provider.id,
          messageCount: items.length,
        });
        window.dispatchEvent(new CustomEvent("tanwords:chat-session-updated", { detail: { sessionId } }));
        return items;
      };

      /** One attempt at the plain Markdown exchange for a given (possibly
       *  truncated) article body. Thrown context-overflow errors are handled
       *  by the caller, which retries with a shorter body. */
      const runExchange = async (userText: string) => {
        let lastAssistantText = "";
        let lastPersistAt = 0;
        await persistTranscript(userText, "");
        armWatchdog();
        for await (const chunk of provider.chat([{ role: "user", content: userText }], sysPrompt, controller.signal)) {
          armWatchdog();
          lastAssistantText += chunk;
          const now = Date.now();
          if (now - lastPersistAt >= 500) {
            lastPersistAt = now;
            await persistTranscript(userText, lastAssistantText);
          }
        }
        disarmWatchdog();

        lastAssistantText = unwrapMarkdownFence(lastAssistantText);
        if (!lastAssistantText.trim()) throw new Error(t("reader.learnEmptyResponse"));
        const items = await persistTranscript(userText, lastAssistantText);
        return { items, lastAssistantText };
      };

      // Local models often run with a small context window (4k/8k). If the
      // full article overflows it, retry with progressively shorter bodies
      // instead of just failing — comments get dropped first, then the
      // article text itself is cut down.
      const CHAR_BUDGETS = [Infinity, 6000, 2500];

      (async () => {
        try {
          let userText = "";
          let items: DisplayItem[] = [];
          let lastAssistantText = "";
          let truncated = false;

          const [knownWords, vocab] = await Promise.all([db.getKnownWords(), db.getWords()]);
          const excludeWords = [
            ...new Set([...knownWords.map((w) => w.toLowerCase()), ...vocab.map((w) => w.word.toLowerCase())]),
          ];
          sysPrompt = buildPresetPrompt("reading-tutor", targetLevel, excludeWords);

          for (let i = 0; i < CHAR_BUDGETS.length; i++) {
            userText = buildArticleBody(article, CHAR_BUDGETS[i]);
            try {
              ({ items, lastAssistantText } = await runExchange(userText));
              break;
            } catch (e: any) {
              const isLastAttempt = i === CHAR_BUDGETS.length - 1;
              if (e?.name === "AbortError" || !isContextOverflowError(e) || isLastAttempt) throw e;
              truncated = true;
            }
          }
          let title = fallbackTitle;
          try {
            let raw = "";
            armWatchdog();
            for await (const chunk of provider.generate(
              "Summarize the following exchange as a short chat title. Output ONLY the title — no quotes, no punctuation at the end, no explanation. Max 10 Chinese characters, or 6 English words, whichever fits the conversation's language.",
              `User: ${userText.slice(0, 500)}\nAssistant: ${lastAssistantText.slice(0, 500)}`,
              controller.signal
            )) { armWatchdog(); raw += chunk; }
            const cleaned = raw.trim().replace(/^["'「『]|["'」』.。!！?？]+$/g, "").slice(0, 24);
            if (cleaned) title = cleaned;
          } catch {
            // Keep the truncated fallback title — the exchange itself already
            // succeeded, so a stalled/failed title call shouldn't fail the job.
          } finally {
            disarmWatchdog();
          }

          await persistTranscript(userText, lastAssistantText, title);

          useLearnChatStore.getState().finishSuccess(articleUrl, sessionId);
          toast.success(t(truncated ? "reader.learnDoneTruncated" : "reader.learnDone", { title: article.title }));
        } catch (e: any) {
          disarmWatchdog();
          if (e?.name === "AbortError") {
            if (stalled) {
              useLearnChatStore.getState().finishError(articleUrl);
              toast.error(t("reader.learnStalled", { title: article.title }));
              return;
            }
            useLearnChatStore.getState().dismiss(articleUrl);
            return;
          }
          useLearnChatStore.getState().finishError(articleUrl);
          toast.error(
            isContextOverflowError(e)
              ? t("reader.learnContextOverflow")
              : e?.message || t("reader.learnFailed", { title: article.title })
          );
        }
      })();
    },
    [db, t, targetLevel]
  );

  return { startLearn };
}
