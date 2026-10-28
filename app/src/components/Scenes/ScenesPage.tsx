import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { toast } from "sonner";
import { findBestProvider } from "@/providers/select";
import { genId } from "@/components/AiChat/aiChatHelpers";
import { Markdown } from "@/components/AiChat/Markdown";
import { renderSpeakingBlockquote } from "@/components/AiChat/SpeakingPhrase";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useWordModalStore } from "@/store/wordModalStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { ChatSessionItem } from "@/hooks/useDB.types";
import {
  ArrowUp,
  ChevronLeft,
  History,
  MapPin,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { SCENE_SYSTEM_PROMPT, buildSceneUserPrompt, sceneSessionTitle } from "./scenePrompts";

/** Scenes — scenario learning as a conversation.
 *
 *  One input, one stream of Markdown. Type a scene ("咖啡厅", "机场值机"),
 *  the coach generates a full handbook — ~100 example lines, each rendered
 *  with TTS and save-to-library buttons — and every follow-up keeps the same
 *  context: more lines, a dialogue script, or a role-play quiz.
 *
 *  Sessions live in the shared `chat_sessions` table under the fixed preset
 *  id below, so history survives restarts and this page lists only its own
 *  conversations, never the AI Chat page's. */
const SCENE_PRESET_ID = "scene-learning";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface ActiveView {
  id: string;
  title: string;
  /** Present when the session was just created — fires the first reply. The
   *  user reviewed both prompts before this ran (the home screen's preview
   *  step), and the system prompt is stored on the session so follow-ups in a
   *  reopened conversation keep using the edited one. */
  seed?: { userPrompt: string; systemPrompt: string };
}

const lookupWord = (word: string) => useWordModalStore.getState().openWordModal(word);

const TOPIC_CHIPS = [
  "scenes.topic.cafe",
  "scenes.topic.airport",
  "scenes.topic.hotel",
  "scenes.topic.doctor",
  "scenes.topic.pharmacy",
  "scenes.topic.interview",
  "scenes.topic.rideshare",
  "scenes.topic.returns",
] as const;

const FOLLOWUP_CHIPS = [
  "scenes.followup.more",
  "scenes.followup.script",
  "scenes.followup.quiz",
  "scenes.followup.hard10",
] as const;

export function ScenesPage() {
  const t = useT();
  const db = useDB();
  /** null = home (hero input + history). */
  const [view, setView] = useState<ActiveView | null>(null);
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [topic, setTopic] = useState("");

  const refreshHistory = useCallback(async () => {
    const all = await db.listChatSessions(0, 100, { archived: false });
    setSessions(all.filter((s) => s.preset_id === SCENE_PRESET_ID));
  }, [db]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory, view]);

  const startScene = useCallback((opts: { topic: string; userPrompt: string; systemPrompt: string }) => {
    setTopic("");
    setView({ id: genId(), title: sceneSessionTitle(opts.topic), seed: { userPrompt: opts.userPrompt, systemPrompt: opts.systemPrompt } });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {view ? (
        <SceneChat
          key={view.id}
          sessionId={view.id}
          initialTitle={view.title}
          seed={view.seed ?? null}
          onBack={() => setView(null)}
          onChanged={refreshHistory}
        />
      ) : (
        <SceneHome
          sessions={sessions}
          topic={topic}
          onTopicChange={setTopic}
          onStart={startScene}
          onOpen={(s) => setView({ id: s.id, title: s.title })}
          onDeleted={refreshHistory}
        />
      )}
    </div>
  );
}

// ── Home: hero input + history ─────────────────────────────────────────────

function SceneHome({
  sessions,
  topic,
  onTopicChange,
  onStart,
  onOpen,
  onDeleted,
}: {
  sessions: ChatSessionItem[];
  topic: string;
  onTopicChange: (v: string) => void;
  onStart: (opts: { topic: string; userPrompt: string; systemPrompt: string }) => void;
  onOpen: (s: ChatSessionItem) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const db = useDB();
  const uiLanguage = useSettingsStore((s) => s.uiLanguage);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatSessionItem | null>(null);
  /** Review step: the exact prompt about to be sent, editable. Topic chips
   *  and the hero input both land here — nothing generates before the user
   *  confirms. `systemPrompt` defaults to the built-in coach prompt and is
   *  editable under the advanced fold; the edited copy rides with the
   *  session (chat_sessions.system_prompt) so follow-ups honor it. */
  const [preview, setPreview] = useState<{ topic: string; userPrompt: string; systemPrompt: string } | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  /** Assemble the default prompt from a topic and open the review step. */
  const beginPreview = (rawTopic: string) => {
    const cleaned = rawTopic.trim();
    if (!cleaned) return;
    setPreview({
      topic: cleaned,
      userPrompt: buildSceneUserPrompt(cleaned, uiLanguage),
      systemPrompt: SCENE_SYSTEM_PROMPT,
    });
  };

  if (preview) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-6 pb-16 pt-14">
          <h2 className="mb-1 text-sm font-semibold text-foreground/90">{t("scenes.previewTitle")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("scenes.previewSubtitle", { topic: preview.topic })}
          </p>

          <textarea
            autoFocus
            value={preview.userPrompt}
            onChange={(e) => setPreview({ ...preview, userPrompt: e.target.value })}
            rows={4}
            className="w-full resize-y rounded-xl border border-border/70 bg-card p-3 text-sm leading-relaxed outline-none transition-colors focus:border-primary/50"
          />

          <details className="mt-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer select-none text-[11px] font-medium text-muted-foreground">
              {t("scenes.systemPromptLabel")}
            </summary>
            <textarea
              value={preview.systemPrompt}
              onChange={(e) => setPreview({ ...preview, systemPrompt: e.target.value })}
              rows={12}
              spellCheck={false}
              className="mt-2 w-full resize-y rounded-lg border border-border/50 bg-background p-2.5 font-mono text-[11px] leading-relaxed outline-none transition-colors focus:border-primary/50"
            />
          </details>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setPreview(null)}
              className="flex h-8 items-center gap-1 rounded-md border border-border/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t("scenes.backToTopic")}
            </button>
            <button
              onClick={() => onStart(preview)}
              disabled={!preview.userPrompt.trim() || !preview.systemPrompt.trim()}
              className="flex h-8 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("scenes.startNow")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const submit = () => beginPreview(topic);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-6 pb-16 pt-14">
        <div className="mb-2 flex items-center gap-2 text-primary/80">
          <MapPin className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">{t("nav.scenes")}</span>
        </div>
        <h1 className="mb-1 text-xl font-bold text-foreground/90">{t("scenes.heroTitle")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("scenes.heroSubtitle")}</p>

        {/* The one input the page is about. */}
        <div className="rounded-2xl border border-border/70 bg-card p-2 shadow-sm transition-colors focus-within:border-primary/50">
          <textarea
            ref={inputRef}
            rows={2}
            value={topic}
            onChange={(e) => onTopicChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("scenes.heroPlaceholder")}
            className="w-full resize-none bg-transparent px-2 pt-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[11px] text-muted-foreground/70">{t("scenes.heroHint")}</span>
            <button
              onClick={submit}
              disabled={!topic.trim()}
              className="flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("scenes.start")}
            </button>
          </div>
        </div>

        {/* Warm-start topics — straight to the preview, never auto-start. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {TOPIC_CHIPS.map((key) => (
            <button
              key={key}
              onClick={() => beginPreview(t(key))}
              className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {t(key)}
            </button>
          ))}
        </div>

        {/* History */}
        {sessions.length > 0 && (
          <div className="mt-10">
            <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              <h2 className="text-xs font-semibold uppercase tracking-wider">
                {t("scenes.history", { n: sessions.length })}
              </h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(s)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpen(s); }}
                  className="group relative cursor-pointer rounded-xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/40"
                >
                  <p className="pr-6 text-sm font-medium leading-snug text-foreground/90">{s.title}</p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/60">
                    {formatSessionDate(t, s.updated_at)} · {t("scenes.msgsCount", { n: s.message_count })}
                  </p>
                  <button
                    aria-label={t("common.delete")}
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(s); }}
                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("scenes.deleteTitle")}
        message={t("scenes.deleteMessage", { title: pendingDelete?.title ?? "" })}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const victim = pendingDelete;
          setPendingDelete(null);
          if (!victim) return;
          void db.deleteChatSession(victim.id).then(onDeleted);
        }}
      />
    </div>
  );
}

// ── Chat: streaming handbook + follow-ups ──────────────────────────────────

function SceneChat({
  sessionId,
  initialTitle,
  seed,
  onBack,
  onChanged,
}: {
  sessionId: string;
  initialTitle: string;
  seed: { userPrompt: string; systemPrompt: string } | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const db = useDB();
  const [title, setTitle] = useState(initialTitle);
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /** The session's system prompt — possibly user-edited at the preview step,
   *  loaded back from `chat_sessions.system_prompt` on reopen. A ref because
   *  the async stream loop must always read the current value. */
  const sysPromptRef = useRef<string>(seed?.systemPrompt ?? SCENE_SYSTEM_PROMPT);

  const persist = useCallback((nextMessages: ChatMsg[], nextTitle: string) => {
    void db.upsertChatSession({
      id: sessionId,
      title: nextTitle,
      messages: JSON.stringify(nextMessages),
      systemPrompt: sysPromptRef.current,
      presetId: SCENE_PRESET_ID,
      providerId: findBestProvider()?.id ?? "",
      messageCount: nextMessages.length,
    }).then(onChanged);
  }, [db, sessionId, onChanged]);

  const streamReply = useCallback(async (history: ChatMsg[], nextTitle: string) => {
    const provider = findBestProvider();
    if (!provider) {
      toast.error(t("scenes.noProvider"));
      return;
    }
    setStreaming(true);
    setMessages([...history, { role: "assistant", content: "" }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";
    try {
      for await (const chunk of provider.chat(history, sysPromptRef.current, controller.signal)) {
        reply += chunk;
        const snapshot = reply;
        setMessages((prev) => {
          const next = [...(prev ?? [])];
          next[next.length - 1] = { role: "assistant", content: snapshot };
          return next;
        });
      }
    } catch {
      if (!controller.signal.aborted) toast.error(t("scenes.genFailed"));
    } finally {
      abortRef.current = null;
      setStreaming(false);
      const done: ChatMsg[] = [...history, { role: "assistant", content: reply }];
      if (reply.trim()) persist(done, nextTitle);
    }
  }, [persist, t]);

  // Existing sessions load their history AND their stored (possibly edited)
  // system prompt; a seeded one generates its first reply immediately.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (seed !== null) {
        const first: ChatMsg[] = [{ role: "user", content: seed.userPrompt }];
        if (!cancelled) setMessages(first);
        await streamReply(first, initialTitle);
        return;
      }
      const detail = await db.getChatSession(sessionId);
      if (cancelled) return;
      if (detail) {
        try {
          const parsed = JSON.parse(detail.messages) as ChatMsg[];
          setMessages(Array.isArray(parsed) ? parsed : []);
          setTitle(detail.title);
          if (detail.system_prompt.trim()) sysPromptRef.current = detail.system_prompt;
          return;
        } catch { /* fall through to empty */ }
      }
      setMessages([]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Keep the tail in view while a reply lands — unless the reader scrolled up.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);
  useEffect(() => {
    if (stickToBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming]);

  const stop = () => abortRef.current?.abort();

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || streaming || !messages) return;
    setInput("");
    const history: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    stickToBottomRef.current = true;
    void streamReply(history, title);
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <button
          onClick={onBack}
          aria-label={t("scenes.backToHome")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-foreground/90">
          {title}
        </h1>
        <button
          onClick={onBack}
          className="flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          {t("scenes.newScene")}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-4">
          {(messages ?? []).map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="mb-5 flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary/10 px-3.5 py-2 text-sm leading-relaxed">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={i} className="mb-6 text-[13px] leading-relaxed text-foreground/90">
                {m.content === "" && streaming && i === (messages?.length ?? 0) - 1 ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    {t("scenes.generating")}
                  </p>
                ) : (
                  <Markdown text={m.content} renderBlockquote={renderSpeakingBlockquote} onWordClick={lookupWord} />
                )}
              </div>
            ),
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/60">
        <div className="mx-auto w-full max-w-2xl px-4 pb-3 pt-2">
          {!streaming && messages !== null && messages.length > 1 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {FOLLOWUP_CHIPS.map((key) => (
                <button
                  key={key}
                  onClick={() => send(t(key))}
                  className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-card p-2 shadow-sm transition-colors focus-within:border-primary/50">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={t("scenes.inputPlaceholder")}
              className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
            />
            {streaming ? (
              <button
                onClick={stop}
                aria-label={t("scenes.stop")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity hover:opacity-80"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                aria-label={t("scenes.send")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Same short relative date as the AI Chat sidebar (today/yesterday/MM-DD). */
function formatSessionDate(t: (key: string) => string, updatedAt: string): string {
  const key = updatedAt.slice(0, 10);
  const at = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (key === at(0)) return t("aichat.today");
  if (key === at(1)) return t("aichat.yesterday");
  return key.slice(5);
}
