import { useCallback } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { useLearnChatStore } from "@/store/learnChatStore";
import {
  buildArticleBody, buildPresetPrompt, genId, isContextOverflowError, serializeItems, type DisplayItem,
} from "@/components/AiChat/aiChatHelpers";
import { getEnabledTools, executeTool, type ToolCall, type ToolGroupKey } from "@/components/AiChat/tools";
import type { ToolCallDisplay } from "@/components/AiChat/ToolCallCard";
import type { ApiMessage } from "@/providers/base";

const ENABLED_GROUPS = new Set<ToolGroupKey>(["vocabulary", "documents"]);
const MAX_ITER = 5;

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
      store.start(articleUrl, controller);

      const sysPrompt = buildPresetPrompt("reading-tutor", targetLevel);
      const tools = getEnabledTools(ENABLED_GROUPS);

      /** One attempt at the full tool-calling exchange for a given (possibly
       *  truncated) article body. Thrown context-overflow errors are handled
       *  by the caller, which retries with a shorter body. */
      const runExchange = async (userText: string) => {
        let items: DisplayItem[] = [{ kind: "message", msg: { role: "user", content: userText } }];
        let apiMsgs: ApiMessage[] = [{ role: "user", content: userText }];
        let lastAssistantText = "";

        if (tools.length > 0 && provider.chatWithTools) {
          for (let iter = 0; iter < MAX_ITER; iter++) {
            const response = await provider.chatWithTools(apiMsgs, sysPrompt, tools, controller.signal);
            lastAssistantText = response.textContent;
            // A turn that's purely a tool call (the reading-tutor prompt asks for
            // vocab via extract_vocabulary with no prose) has no text to show —
            // skip the bubble rather than rendering an empty one.
            if (response.textContent.trim()) {
              items = [...items, { kind: "message", msg: { role: "assistant", content: response.textContent } }];
            }

            if (response.toolCalls.length === 0 || response.stopReason !== "tool_use") break;

            const results = await Promise.all(response.toolCalls.map((tc) => executeTool(tc as ToolCall)));

            // extract_vocabulary/extract_patterns deliberately make no DB write of their
            // own: nothing is saved automatically. The extracted items live on in the
            // saved transcript, and when the user opens the finished session in AI Chat
            // the review cards render from it with add/select controls — the user decides
            // there what enters the vocabulary list or sentence library.

            const calls: ToolCallDisplay[] = response.toolCalls.map((tc, i) => ({
              id: tc.id,
              name: tc.name,
              input: tc.input,
              result: results[i].content,
              is_error: results[i].is_error,
              status: results[i].is_error ? "error" : "done",
            }));
            items = [...items, { kind: "tool_block", calls }];

            apiMsgs = [
              ...apiMsgs,
              {
                role: "assistant",
                content: [
                  ...(response.textContent ? [{ type: "text" as const, text: response.textContent }] : []),
                  ...response.toolCalls.map((tc) => ({
                    type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.input,
                  })),
                ],
              },
              {
                role: "user",
                content: results.map((r) => ({
                  type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content, is_error: r.is_error,
                })),
              },
            ];
          }
        } else {
          for await (const chunk of provider.chat([{ role: "user", content: userText }], sysPrompt, controller.signal)) {
            lastAssistantText += chunk;
          }
          if (lastAssistantText.trim()) {
            items = [...items, { kind: "message", msg: { role: "assistant", content: lastAssistantText } }];
          }
        }

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
          if (truncated) toast.info(t("reader.learnTruncated"));

          let title = article.title.slice(0, 50) + (article.title.length > 50 ? "…" : "");
          try {
            let raw = "";
            for await (const chunk of provider.generate(
              "Summarize the following exchange as a short chat title. Output ONLY the title — no quotes, no punctuation at the end, no explanation. Max 10 Chinese characters, or 6 English words, whichever fits the conversation's language.",
              `User: ${userText.slice(0, 500)}\nAssistant: ${lastAssistantText.slice(0, 500)}`
            )) raw += chunk;
            const cleaned = raw.trim().replace(/^["'「『]|["'」』.。!！?？]+$/g, "").slice(0, 24);
            if (cleaned) title = cleaned;
          } catch {
            // Keep the truncated fallback title.
          }

          const sessionId = genId();
          await db.upsertChatSession({
            id: sessionId,
            title,
            messages: serializeItems(items),
            systemPrompt: sysPrompt,
            presetId: "reading-tutor",
            providerId: provider.id,
            messageCount: items.filter((i) => i.kind === "message").length,
          });

          useLearnChatStore.getState().finishSuccess(articleUrl, sessionId);
          toast.success(t("reader.learnDone", { title: article.title }));
        } catch (e: any) {
          if (e?.name === "AbortError") {
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
