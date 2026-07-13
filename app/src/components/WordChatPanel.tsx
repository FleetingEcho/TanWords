import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDB } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { MessageBubble } from "@/components/AiChat/MessageBubble";
import { LazyWordNotesEditor } from "@/components/LazyWordNotesEditor";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PanelProps {
  wordId: number | null;
  word: string;
  enrichedContext?: string;
}

function buildSystemPrompt(word: string, context: string): string {
  return `You are a vocabulary tutor helping the user deeply understand the English word "${word}".

${context ? `Enrichment data for this word:\n${context}\n` : ""}Your role:
1. Answer questions about this word — usage, nuance, examples, etymology, collocations
2. Provide concrete examples when helpful
3. Help the user understand subtle differences from synonyms
4. Respond in 中文 (Chinese) unless the user writes in English
5. Keep responses concise (under 200 words) unless depth is requested`;
}

// ── Inner panel ──────────────────────────────────────────────────────────────

export function WordChatPanel({ wordId, word, enrichedContext = "" }: PanelProps) {
  const db = useDB();
  const t = useT();
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const [notes, setNotes] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevWordKeyRef = useRef<string>("");

  // Reload notes + chat whenever word/wordId changes (no early-return optimization — always reload to stay fresh)
  useEffect(() => {
    const key = wordId ? `id:${wordId}` : `word:${word}`;
    if (key === prevWordKeyRef.current) return;
    prevWordKeyRef.current = key;

    // Abort any in-flight chat stream
    controllerRef.current?.abort();
    setStreaming(false);
    // Immediately clear stale data so user sees blank, not previous word's data
    setMessages([]);
    setNotes("");
    setInput("");

    if (wordId) {
      db.getWordExtras(wordId).then((extras) => {
        // Guard: ensure the word hasn't changed again while we waited
        if (prevWordKeyRef.current !== key) return;
        setNotes(extras.notes || "");
        try { setMessages(JSON.parse(extras.messages || "[]")); } catch { setMessages([]); }
      });
    }
  }, [wordId, word]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Sync notes when saved from another panel (e.g. VocabularyPage inline editor)
  useEffect(() => {
    const handler = (e: Event) => {
      const { wordId: updatedId, notes: updatedNotes } = (e as CustomEvent).detail;
      if (updatedId === wordId) setNotes(updatedNotes);
    };
    window.addEventListener("word-notes-updated", handler);
    return () => window.removeEventListener("word-notes-updated", handler);
  }, [wordId]);

  const saveNotes = useCallback(async (text: string) => {
    if (!wordId) return;
    setNotes(text);
    try {
      await db.saveWordNotes(wordId, text);
      window.dispatchEvent(new CustomEvent("word-notes-updated", { detail: { wordId, notes: text } }));
    } catch {
      toast.error(t("chat.requestFailed"));
    }
  }, [wordId, t]);

  const saveChatMessages = useCallback(async (msgs: ChatMessage[]) => {
    if (!wordId) return;
    await db.saveWordChat(wordId, JSON.stringify(msgs));
  }, [wordId]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const provider = findBestProvider();
    if (!provider?.apiKey) {
      setMessages((prev) => [...prev, { role: "assistant", content: t("chat.noApiKey") }]);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    controllerRef.current = controller;

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    try {
      for await (const chunk of provider.chat(newMessages, buildSystemPrompt(word, enrichedContext), controller.signal)) {
        if (controller.signal.aborted) break;
        assistantMsg.content += chunk;
        setMessages([...newMessages, { ...assistantMsg }]);
      }
      if (!controller.signal.aborted) {
        const final = [...newMessages, assistantMsg];
        setMessages(final);
        await saveChatMessages(final);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      const errMsg = e.message || t("chat.requestFailed");
      const errMsgs = [...newMessages, { role: "assistant" as const, content: `❌ ${errMsg}` }];
      setMessages(errMsgs);
      await saveChatMessages(errMsgs);
    } finally {
      if (!controller.signal.aborted) setStreaming(false);
    }
  };

  const clearChat = async () => {
    controllerRef.current?.abort();
    setStreaming(false);
    setMessages([]);
    if (wordId) await db.saveWordChat(wordId, "[]");
  };

  const stopStreaming = () => {
    controllerRef.current?.abort();
    setStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex gap-1 mb-3 shrink-0">
        <button
          onClick={() => setTab("chat")}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            tab === "chat" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t("chat.tabChat")}
        </button>
        <button
          onClick={() => setTab("notes")}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            tab === "notes" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t("chat.tabNotes")}
        </button>
      </div>

      {/* Notes tab — same BlockNote editor chrome as Documents, bound to a plain-text column */}
      {tab === "notes" && (
        <div className="flex flex-col flex-1 gap-1 overflow-hidden">
          {wordId ? (
            <LazyWordNotesEditor wordId={wordId} text={notes} onChange={saveNotes} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-center px-4">
              <p className="text-xs text-muted-foreground">{t("chat.notesNoIdHint")}</p>
            </div>
          )}
        </div>
      )}

      {/* Chat tab */}
      {tab === "chat" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto space-y-3 pb-1 pr-0.5" style={{ minHeight: 0 }}>
            {messages.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-xs">
                <p className="mb-1 font-semibold text-foreground/70">{word}</p>
                <p className="opacity-60">{t("chat.chatEmpty")}</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isTyping =
                streaming &&
                i === messages.length - 1 &&
                msg.role === "assistant" &&
                !msg.content;
              return <MessageBubble key={i} msg={msg} compact isTyping={isTyping} />;
            })}
            <div ref={bottomRef} />
          </div>

          <div className="pt-3 shrink-0 border-t border-border mt-2">
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={t("chat.inputPlaceholder")}
                rows={1}
                disabled={streaming}
                className="flex-1 resize-none px-3 py-2.5 text-xs rounded-xl border border-input bg-card placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 leading-relaxed min-h-[36px]"
              />
              {streaming ? (
                <button
                  onClick={stopStreaming}
                  className="shrink-0 px-3 h-9 rounded-xl text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-[2px] bg-destructive" />
                  {t("aichat.stop")}
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="shrink-0 px-3 h-9 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-1"
                >
                  {t("chat.send")}
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M1.5 1.5l13 6.5-13 6.5V9.5l9-3-9-3V1.5z" /></svg>
                </button>
              )}
            </div>
            {messages.length > 0 && (
              <button onClick={clearChat} className="mt-1.5 text-[10px] text-muted-foreground hover:text-destructive transition-colors">
                {t("chat.clear")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
