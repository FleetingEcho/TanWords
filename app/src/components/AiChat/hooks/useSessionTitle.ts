import { AIProvider } from "@/providers/base";
import type { ChatSidebarState } from "./useChatSidebar";
import type { ChatSessionState } from "./useChatSession";

/** Best-effort short title generated from a session's first exchange —
 * split out of useSendMessage purely to keep that file under the line
 * budget; it's a single self-contained async helper with no other callers. */
export function useSessionTitle(sidebar: ChatSidebarState, session: ChatSessionState) {
  const { itemsRef, activeIdRef, setActiveTitle, systemPrompt, selectedPreset, selectedProviderId } = session;

  const generateSessionTitle = async (
    sessionId: string,
    userText: string,
    assistantText: string,
    provider: AIProvider
  ) => {
    try {
      const sys = "Summarize the following exchange as a short chat title. Output ONLY the title — no quotes, no punctuation at the end, no explanation. Max 10 Chinese characters, or 6 English words, whichever fits the conversation's language.";
      const user = `User: ${userText.slice(0, 500)}\nAssistant: ${assistantText.slice(0, 500)}`;
      let raw = "";
      for await (const chunk of provider.generate(sys, user)) raw += chunk;
      const cleaned = raw.trim().replace(/^["'「『]|["'」』.。!！?？]+$/g, "").slice(0, 24);
      if (!cleaned || activeIdRef.current !== sessionId) return;

      setActiveTitle((prev) => (activeIdRef.current === sessionId ? cleaned : prev));
      await sidebar.saveSession(sessionId, cleaned, itemsRef.current, systemPrompt, selectedPreset, selectedProviderId);
    } catch {
      // Keep the truncated fallback title already saved.
    }
  };

  return { generateSessionTitle };
}
