import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDB } from "@/hooks/useDB";
import { findBestProvider } from "@/providers/select";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { MessageBubble } from "@/components/AiChat/MessageBubble";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PanelProps {
  wordId: number | null;
  word: string;
  enrichedContext?: string;
}

interface FABProps extends PanelProps {
  insideModal?: boolean;
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
  const [saving, setSaving] = useState(false);
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

  const saveNotes = useCallback(async () => {
    if (!wordId) {
      toast.error(t("chat.notesNoId"));
      return;
    }
    setSaving(true);
    try {
      await db.saveWordNotes(wordId, notes);
      window.dispatchEvent(new CustomEvent("word-notes-updated", { detail: { wordId, notes } }));
      toast.success(t("vocab.save") + " ✓");
    } catch {
      toast.error(t("chat.requestFailed"));
    } finally {
      setSaving(false);
    }
  }, [wordId, notes, t]);

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

      {/* Notes tab */}
      {tab === "notes" && (
        <div className="flex flex-col flex-1 gap-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={wordId ? t("chat.notesPlaceholder", { word }) : t("chat.notesNoId")}
            className="flex-1 resize-none p-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground leading-relaxed"
            readOnly={!wordId}
          />
          <div className="flex items-center justify-between">
            {!wordId && (
              <p className="text-xs text-muted-foreground">{t("chat.notesNoIdHint")}</p>
            )}
            <button
              onClick={saveNotes}
              disabled={saving || !wordId}
              className="ml-auto px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {saving ? t("chat.saving") : t("chat.saveNotes")}
            </button>
          </div>
        </div>
      )}

      {/* Chat tab */}
      {tab === "chat" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto space-y-2.5 pb-1 pr-0.5" style={{ minHeight: 0 }}>
            {messages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-xs">
                <p className="mb-1 font-medium text-foreground/60">{word}</p>
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

          <div className="pt-2 shrink-0 border-t border-border mt-2">
            <div className="flex gap-1.5 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={t("chat.inputPlaceholder")}
                rows={2}
                className="flex-1 resize-none px-3 py-2 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || streaming}
                  className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  {streaming ? "…" : t("chat.send")}
                </button>
                {messages.length > 0 && (
                  <button onClick={clearChat} className="px-2 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-destructive transition-colors">
                    {t("chat.clear")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Floating chat button (FAB) ───────────────────────────────────────────────

export function FloatingChatButton({ wordId, word, enrichedContext = "", insideModal = false }: FABProps) {
  const [open, setOpen] = useState(false);
  const t = useT();

  // Close panel when word changes
  useEffect(() => { setOpen(false); }, [word, wordId]);

  const positionClass = insideModal
    ? "absolute bottom-5 right-5"
    : "fixed bottom-6 right-6";

  return (
    <div className={`${positionClass} z-50 flex flex-col items-end gap-2`} style={{ pointerEvents: "none" }}>
      {/* Panel */}
      <div
        style={{
          pointerEvents: open ? "auto" : "none",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.92) translateY(8px)",
          transformOrigin: "bottom right",
          transition: "opacity 0.18s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
          width: "320px",
          height: "460px",
        }}
        className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-foreground">{word}</span>
          <button
            onClick={() => setOpen(false)}
            className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors text-xs"
            style={{ pointerEvents: "auto" }}
          >
            ✕
          </button>
        </div>
        <div className="flex-1 p-3 overflow-hidden">
          {/* Mount fresh panel on each open to guarantee a DB reload */}
          {open && <WordChatPanel wordId={wordId} word={word} enrichedContext={enrichedContext} />}
        </div>
      </div>

      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ pointerEvents: "auto" }}
        className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open
            ? "bg-muted text-muted-foreground hover:bg-muted/80"
            : "bg-primary text-white hover:opacity-90 hover:scale-105"
        }`}
        aria-label={open ? t("chat.close") : t("chat.open")}
      >
        {open ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    </div>
  );
}
