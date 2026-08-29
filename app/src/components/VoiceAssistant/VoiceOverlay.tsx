import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, X, Minus, Loader2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useVoiceAssistantStore } from "@/store/voiceAssistantStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useNavStore } from "@/store/navStore";
import { findBestProvider } from "@/providers/select";
import { ApiMessage, VOICE_ASSISTANT_SYSTEM_PROMPT } from "@/providers/base";
import { synthesizeBlob, WebSpeechFallbackRequired, ensureTtsLoaded } from "@/lib/ttsBackend";
import { transcribeWav, ensureAsrLoaded } from "@/lib/asrBackend";
import { MicPermissionError, PcmRecorder } from "@/lib/voiceRecorder";
import { DisplayItem, buildApiHistory, genId, serializeItems } from "@/components/AiChat/aiChatHelpers";
import { ToolCall, getEnabledTools, executeTool } from "@/components/AiChat/tools";
import type { ToolCallDisplay } from "@/components/AiChat/ToolCallCard";

type Status = "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "error";

interface VoiceMessage {
  role: "user" | "assistant";
  text: string;
}

// Only vocabulary/sentence tools — not documents/calendar. Matches the scope
// the user asked for ("生成几个单词帮我存起来"), and keeps the voice
// assistant's failure surface small (fewer tools the model could misfire).
const VOICE_TOOL_GROUPS = new Set(["vocabulary"] as const);

const MAX_TOOL_ITERATIONS = 3;

// Splits a growing text buffer into complete sentences (Chinese and English
// terminators) plus whatever incomplete tail remains, so TTS can start on
// the first sentence before the LLM has finished generating the rest.
function extractSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if ("。！？.!?\n".includes(c) && i - start > 0) {
      const piece = buffer.slice(start, i + 1).trim();
      if (piece) sentences.push(piece);
      start = i + 1;
    }
  }
  return { sentences, rest: buffer.slice(start) };
}

/** Independent voice-chat popup: push-to-talk speech in, streamed LLM reply
 *  out (with vocabulary/sentence tool-calling), spoken sentence-by-sentence
 *  as it arrives. Its own minimal UI (a caption, not a scrollable transcript)
 *  is deliberately not a reuse of AiChatPage's rendering — but it persists
 *  into the exact same `ai_chat_sessions` storage via `db.upsertChatSession`,
 *  so a voice conversation shows up in and can be reopened from the regular
 *  AI Chat history/sidebar. */
export function VoiceOverlay() {
  const t = useT();
  const db = useDB();
  const isOpen = useVoiceAssistantStore((s) => s.isOpen);
  const close = useVoiceAssistantStore((s) => s.close);
  const asrModelPath = useSettingsStore((s) => s.asrModelPath);
  const ttsModelPath = useSettingsStore((s) => s.ttsModelPath);
  const navigate = useNavStore((s) => s.navigate);

  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  // Warm the persisted models up as soon as the popup opens, so the first
  // recording/reply isn't paying for a cold load. No ASR model configured is
  // a hard blocker (shown as a setup prompt instead of the normal orb); no
  // TTS model just degrades to text-only replies, so it's not blocking.
  useEffect(() => {
    if (!isOpen) return;
    if (asrModelPath) void ensureAsrLoaded();
    if (ttsModelPath) void ensureTtsLoaded();
  }, [isOpen, asrModelPath, ttsModelPath]);

  const recorderRef = useRef<PcmRecorder | null>(null);
  // A recording whose async start (permission prompt + AudioContext + worklet)
  // has not resolved yet. `startRecording` only flips status to "recording"
  // afterwards, so a quick tap — down/up before that resolves — finds
  // `recorderRef` still null and used to leak a live mic with no way to stop
  // it. The start-side recorder is tracked separately so both an early
  // release and `stopEverything` can cancel it.
  const recordingStartRef = useRef<PcmRecorder | null>(null);
  // Set when the orb is released while the async start is still in flight —
  // the tap is treated as a normal tap-and-send once the recorder is up.
  const releaseDuringStartRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioQueueRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const stoppedRef = useRef(false);
  // Turn-completion bookkeeping: the LLM stream, its sentence-by-sentence
  // TTS synthesis, and audio playback all finish at different, overlapping
  // times. `maybeFinishTurn` only settles back to idle once all three are
  // actually done — checking synchronously at any single one of them would
  // race (e.g. the stream can finish while a sentence is still synthesizing).
  const streamDoneRef = useRef(false);
  const pendingSpeechRef = useRef(0);
  const captionRef = useRef<HTMLDivElement>(null);

  // Persistence: the same `DisplayItem[]`/session-row shape AiChatPage reads,
  // built up in parallel with the lightweight `messages` caption state. One
  // session id for the whole popup's lifetime (it stays mounted across
  // open/close, same as before persistence existed) rather than one per turn.
  const sessionIdRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const itemsRef = useRef<DisplayItem[]>([]);

  async function persistSession() {
    if (!sessionIdRef.current) return;
    try {
      await db.upsertChatSession({
        id: sessionIdRef.current,
        title: titleRef.current || t("voice.title"),
        messages: serializeItems(itemsRef.current),
        systemPrompt: VOICE_ASSISTANT_SYSTEM_PROMPT,
        presetId: "custom",
        providerId: findBestProvider()?.id ?? "",
        messageCount: itemsRef.current.filter((i) => i.kind === "message").length,
      });
      // Lets an AiChatPage that happens to be open elsewhere pick up the
      // write live — see useChatSession's onExternalSessionUpdate listener.
      window.dispatchEvent(new CustomEvent("tanwords:chat-session-updated", { detail: { sessionId: sessionIdRef.current } }));
    } catch (e) {
      console.warn("voice session autosave failed", e);
    }
  }

  // Caption text is no longer clamped to a fixed number of lines (that cut
  // long replies off mid-sentence) — it scrolls instead, so keep it pinned
  // to the newest text as it streams in rather than leaving the user
  // stranded on whatever line they were on.
  useEffect(() => {
    captionRef.current?.scrollTo({ top: captionRef.current.scrollHeight });
  }, [messages]);

  // Closing the popup mid-turn shouldn't leave a recorder or a network
  // request running in the background.
  useEffect(() => {
    if (!isOpen) stopEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function stopEverything() {
    stoppedRef.current = true;
    releaseDuringStartRef.current = false;
    recordingStartRef.current?.cancel();
    recordingStartRef.current = null;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    audioQueueRef.current = [];
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    setStatus("idle");
    // Whatever the assistant had streamed/tool-called before being cut off
    // is still worth keeping, same as AiChat's own stop-mid-turn behavior.
    void persistSession();
  }

  /** Called once the stream, all pending TTS synthesis, and playback have
   *  all finished — goes back to idle, ready for the next press-and-hold.
   *  Deliberately does NOT auto-start recording: that was tried and made
   *  every pause between phrases look like the app was randomly cutting the
   *  user off mid-sentence, because a recording that starts itself has no
   *  natural "release" to end it. Holding the orb down is what starts a
   *  recording now, so the user is always the one deciding when a turn
   *  begins and ends. */
  function maybeFinishTurn() {
    if (stoppedRef.current) return;
    if (!streamDoneRef.current || pendingSpeechRef.current > 0) return;
    if (audioQueueRef.current.length > 0 || currentAudioRef.current) return;
    setStatus("idle");
  }

  async function startRecording() {
    setError(null);
    const recorder = new PcmRecorder();
    recorder.onLevel = (peak) => setLevel(peak);
    // A quick tap can release before getUserMedia resolves: arm the stop
    // flag so the continuation below treats this start as already
    // cancelled, and remember the recorder so `stopEverything` can cancel
    // the pending mic.
    recordingStartRef.current = recorder;
    try {
      await recorder.start();
    } catch {
      if (recordingStartRef.current === recorder) recordingStartRef.current = null;
      setError(t("voice.micFailed"));
      return;
    }
    if (recordingStartRef.current === recorder) recordingStartRef.current = null;
    // The popup was closed (or an early release cancelled this turn) while
    // the permission prompt was up — do not resurrect the turn.
    if (stoppedRef.current) {
      recorder.cancel();
      return;
    }
    recorderRef.current = recorder;
    setStatus("recording");
    // The orb was released while the async start was in flight — treat it
    // as a tap: the recording that just came alive is stopped right away.
    if (releaseDuringStartRef.current) {
      releaseDuringStartRef.current = false;
      recorderRef.current = recorder;
      void stopRecordingAndSend();
    }
  }

  async function stopRecordingAndSend() {
    // Releasing the orb starts a new turn: clear the stop flag a previous
    // `stopEverything` set (askLlm no longer clears it itself, so a cancelled
    // turn cannot be resurrected by a late transcription).
    stoppedRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    setStatus("transcribing");
    let wavBase64: string;
    try {
      wavBase64 = await recorder.stop();
    } catch (e) {
      setStatus("idle");
      setError(e instanceof MicPermissionError ? t("voice.micSilent") : t("voice.recordFailed"));
      return;
    }

    // The popup was closed while the upload/transcription was in flight —
    // do not resurrect the turn below (and let a mid-flight close win over
    // a late-arriving transcription).
    if (stoppedRef.current) return;

    let text: string;
    try {
      text = await transcribeWav(wavBase64);
    } catch (e) {
      setStatus("idle");
      setError(t("voice.transcribeFailed", { error: String(e) }));
      return;
    }
    if (stoppedRef.current) return;
    if (!text.trim()) {
      setStatus("idle");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text }]);
    await askLlm(text);
  }

  async function askLlm(userText: string) {
    const provider = findBestProvider();
    if (!provider) {
      setStatus("idle");
      setError(t("voice.noProvider"));
      return;
    }

    if (!sessionIdRef.current) sessionIdRef.current = genId();
    if (itemsRef.current.length === 0) {
      titleRef.current = userText.slice(0, 50) + (userText.length > 50 ? "…" : "");
    }
    itemsRef.current = [...itemsRef.current, { kind: "message", msg: { role: "user", content: userText } }];
    // Save the user's turn immediately — same reasoning as AiChat's
    // sendMessage: a new session shows up in History right away and survives
    // a request failure, instead of only appearing once a reply exists.
    void persistSession();

    // A late-arriving transcription for a turn the user already cancelled
    // must not resurrect the pipeline — `stopEverything` set the stop flag,
    // and resetting it here (as this used to) un-stopped the turn: the LLM
    // request ran with a fresh AbortController and the reply was spoken out
    // loud with no popup on screen.
    if (stoppedRef.current) return;
    streamDoneRef.current = false;
    pendingSpeechRef.current = 0;
    setStatus("thinking");
    setMessages((prev) => [...prev, { role: "assistant", text: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;
    audioQueueRef.current = [];

    const tools = getEnabledTools(VOICE_TOOL_GROUPS);
    let apiMsgs: ApiMessage[] = buildApiHistory(itemsRef.current);
    itemsRef.current = [...itemsRef.current, { kind: "message", msg: { role: "assistant", content: "" } }];

    const setLastAssistantItem = (content: string) => {
      itemsRef.current = itemsRef.current.map((item, idx) =>
        idx === itemsRef.current.length - 1 && item.kind === "message"
          ? { kind: "message", msg: { role: "assistant", content } }
          : item
      );
    };

    let buffer = "";
    let full = "";
    const onChunk = (chunk: string) => {
      if (stoppedRef.current) return;
      buffer += chunk;
      full += chunk;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", text: full };
        return next;
      });
      const { sentences, rest } = extractSentences(buffer);
      buffer = rest;
      for (const sentence of sentences) enqueueSpeech(sentence);
    };

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (stoppedRef.current) return;

        if (tools.length > 0 && provider.chatWithTools) {
          const response = await provider.chatWithTools(apiMsgs, VOICE_ASSISTANT_SYSTEM_PROMPT, tools, controller.signal, onChunk);
          setLastAssistantItem(response.textContent);

          if (response.toolCalls.length === 0 || response.stopReason !== "tool_use") break;

          const pendingCalls: ToolCallDisplay[] = response.toolCalls.map((tc) => ({
            id: tc.id, name: tc.name, input: tc.input as Record<string, unknown>, status: "pending",
          }));
          itemsRef.current = [...itemsRef.current, { kind: "tool_block", calls: pendingCalls }];
          void persistSession();

          const results = await Promise.all(response.toolCalls.map((tc) => executeTool(tc as ToolCall)));
          const doneCalls: ToolCallDisplay[] = pendingCalls.map((pc, i) => ({
            ...pc, result: results[i].content, is_error: results[i].is_error, status: results[i].is_error ? "error" : "done",
          }));
          itemsRef.current = itemsRef.current.map((item, idx) =>
            idx === itemsRef.current.length - 1 ? { kind: "tool_block", calls: doneCalls } : item
          );

          apiMsgs = [
            ...apiMsgs,
            {
              role: "assistant",
              content: [
                ...(response.textContent ? [{ type: "text" as const, text: response.textContent }] : []),
                ...response.toolCalls.map((tc) => ({ type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.input })),
              ],
            },
            {
              role: "user",
              content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content, is_error: r.is_error })),
            },
          ];
          itemsRef.current = [...itemsRef.current, { kind: "message", msg: { role: "assistant", content: "" } }];
        } else {
          // Only reachable if the provider doesn't implement chatWithTools —
          // flatten the history to plain string turns the same way
          // useSendMessage's own no-tools fallback does.
          const simpleMsgs = apiMsgs.map((m) =>
            typeof m.content === "string"
              ? { role: m.role, content: m.content }
              : { role: m.role, content: m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("") }
          );
          let iterText = "";
          for await (const chunk of provider.chat(simpleMsgs, VOICE_ASSISTANT_SYSTEM_PROMPT, controller.signal)) {
            if (stoppedRef.current) return;
            iterText += chunk;
            onChunk(chunk);
          }
          setLastAssistantItem(iterText);
          break;
        }
      }
      if (buffer.trim()) enqueueSpeech(buffer);
    } catch (e) {
      if (!stoppedRef.current) setError(t("voice.chatFailed", { error: String(e) }));
    } finally {
      streamDoneRef.current = true;
      maybeFinishTurn();
      void persistSession();
    }
  }

  async function enqueueSpeech(text: string) {
    pendingSpeechRef.current += 1;
    try {
      // Same controller that aborts the LLM stream — closing the popup (or
      // hitting Stop) cancels this sentence's synthesis request too, not
      // just its result, so an unread sentence never keeps costing CPU on
      // the backend after the user has already walked away from it.
      const blob = await synthesizeBlob(text, abortRef.current?.signal);
      if (stoppedRef.current) return;
      audioQueueRef.current.push(blob);
      if (!currentAudioRef.current) playNext();
    } catch (e) {
      // Cancelled (popup closed / Stop pressed) or no local TTS model
      // configured/loaded — degrade to text-only rather than surfacing an
      // error for every sentence.
      if (!stoppedRef.current && !(e instanceof WebSpeechFallbackRequired)) console.warn("voice TTS failed", e);
    } finally {
      pendingSpeechRef.current -= 1;
      maybeFinishTurn();
    }
  }

  function playNext() {
    const blob = audioQueueRef.current.shift();
    if (!blob) {
      currentAudioRef.current = null;
      maybeFinishTurn();
      return;
    }
    setStatus("speaking");
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudioRef.current = audio;
    const advance = () => {
      URL.revokeObjectURL(url);
      if (stoppedRef.current) return;
      playNext();
    };
    audio.onended = advance;
    audio.onerror = advance;
    void audio.play();
  }

  const busy = status === "transcribing" || status === "thinking";
  const noAsrModel = !asrModelPath;
  const canRecord = !noAsrModel && (status === "idle" || status === "recording");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") ?? null;
  const lastUser = [...messages].reverse().find((m) => m.role === "user") ?? null;

  const orbGlow: Record<Status, string> = {
    idle: "rgba(139, 92, 246, 0.55)", // violet
    recording: "rgba(244, 63, 94, 0.65)", // rose
    transcribing: "rgba(139, 92, 246, 0.55)",
    thinking: "rgba(168, 85, 247, 0.6)", // purple
    speaking: "rgba(45, 212, 191, 0.65)", // teal
    error: "rgba(244, 63, 94, 0.5)",
  };
  const orbAnimation =
    status === "recording"
      ? "animate-voice-pulse"
      : status === "idle"
        ? "animate-voice-breathe"
        : status === "thinking"
          ? "animate-voice-pulse"
          : "";

  const goToVoiceSettings = () => {
    close();
    navigate("settings", undefined, "voice");
  };

  // Minimize just hides the popup — stopEverything() (via the isOpen effect)
  // already halts any in-flight recording/turn, but sessionIdRef/itemsRef/
  // messages are untouched, so reopening continues the same conversation.
  // Close additionally ends it: next open starts a brand-new session instead
  // of picking the old one back up.
  const endConversation = () => {
    close();
    sessionIdRef.current = null;
    titleRef.current = "";
    itemsRef.current = [];
    setMessages([]);
    setError(null);
  };

  return (
    <Dialog open={isOpen} onClose={close} maxWidth="max-w-[400px]" className="!bg-transparent !border-0 !shadow-none !p-0">
      <div
        className="w-full h-[560px] max-h-[calc(100vh-4rem)] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-white/10"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, #1b1330 0%, #0a0a10 60%, #050507 100%)" }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-white/80">{t("voice.title")}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={close}
              title={t("voice.minimize")}
              aria-label={t("voice.minimize")}
              className="h-7 w-7 rounded-md flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={endConversation}
              title={t("voice.endConversation")}
              aria-label={t("voice.endConversation")}
              className="h-7 w-7 rounded-md flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {noAsrModel ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Mic className="h-8 w-8 text-white/25" />
            <p className="text-sm text-white/70 leading-relaxed">{t("voice.noModelHint")}</p>
            <Button onClick={goToVoiceSettings} className="h-9 px-4 rounded-lg text-xs font-semibold">
              {t("voice.goToSettings")}
            </Button>
          </div>
        ) : (
          <>
            <div
              ref={captionRef}
              className="px-6 pt-1 pb-2 flex flex-col items-center gap-1 min-h-[64px] max-h-[190px] overflow-y-auto text-center"
            >
              {lastUser && <p className="text-[11px] text-white/40">{t("voice.youSaid")}: {lastUser.text}</p>}
              {lastAssistant ? (
                <p className="text-sm text-white/90 leading-snug whitespace-pre-wrap">
                  {lastAssistant.text || (busy ? "…" : "")}
                </p>
              ) : (
                !lastUser && <p className="text-xs text-white/35 mt-3">{t("voice.hint")}</p>
              )}
              {error && <p className="text-xs text-rose-400">{error}</p>}
              {!ttsModelPath && !lastAssistant && (
                <button
                  type="button"
                  onClick={goToVoiceSettings}
                  className="text-[10px] text-white/30 hover:text-white/50 underline underline-offset-2 mt-1"
                >
                  {t("voice.noTtsModelHint")}
                </button>
              )}
            </div>

            <div className="flex-1 flex items-center justify-center">
              <button
                type="button"
                // Press-and-hold, not click-to-toggle: holding is what starts a
                // recording and releasing is what ends and sends it, so there's
                // never any ambiguity about when a turn begins/ends (a click-based
                // toggle made every pause between phrases look like the app was
                // randomly cutting the user off). Pointer capture keeps the "up"
                // event landing on this button even if the pointer drifts off it
                // mid-press, instead of needing a separate mouseleave safety net.
                onPointerDown={(e) => {
                  if (status !== "idle") return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  void startRecording();
                }}
                onPointerUp={(e) => {
                  // A quick tap releases before the async start resolves and
                  // status is still "idle" — record the release so
                  // `startRecording` stops and sends the moment it comes up.
                  if (status === "idle" && recordingStartRef.current) {
                    releaseDuringStartRef.current = true;
                    return;
                  }
                  if (status !== "recording") return;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  void stopRecordingAndSend();
                }}
                onPointerCancel={() => {
                  // A cancelled press (e.g. a system gesture takes over) must
                  // not leave a mic running — same handling as release, minus
                  // the send when nothing was recorded yet.
                  if (status === "idle" && recordingStartRef.current) {
                    recordingStartRef.current.cancel();
                    recordingStartRef.current = null;
                    return;
                  }
                  if (status === "recording") void stopRecordingAndSend();
                }}
                disabled={!canRecord}
                aria-label={status === "recording" ? t("voice.releaseToSend") : t("voice.idleHint")}
                className={`relative h-44 w-44 rounded-full flex items-center justify-center transition-[box-shadow] duration-500 select-none touch-none ${orbAnimation} ${canRecord ? "cursor-pointer" : "cursor-default"}`}
                style={
                  {
                    "--voice-level": Math.min(1, level * 3).toFixed(3),
                    background: `radial-gradient(60% 60% at 50% 45%, ${orbGlow[status]}, transparent 70%)`,
                    boxShadow: `0 0 60px 10px ${orbGlow[status]}`,
                    border: `1px solid ${orbGlow[status]}`,
                  } as React.CSSProperties
                }
              >
                {status === "transcribing" && (
                  <span
                    className="absolute inset-3 rounded-full animate-voice-spin"
                    style={{ background: `conic-gradient(${orbGlow.transcribing}, transparent 70%)`, mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))" } as React.CSSProperties}
                  />
                )}
                {status === "speaking" ? (
                  <span className="flex items-end gap-1 h-8">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 rounded-full bg-white/80 animate-voice-bar"
                        style={{ height: "100%", animationDelay: `${i * 120}ms` }}
                      />
                    ))}
                  </span>
                ) : status === "transcribing" || status === "thinking" ? (
                  <Loader2 className="h-8 w-8 text-white/80 animate-spin" />
                ) : (
                  <Mic className="h-8 w-8 text-white/85" />
                )}
              </button>
            </div>

            <div className="flex flex-col items-center gap-2 pb-6">
              <span className="text-xs text-white/50">
                {status === "recording" && t("voice.recording")}
                {status === "transcribing" && t("voice.transcribing")}
                {status === "thinking" && t("voice.thinking")}
                {status === "speaking" && t("voice.speaking")}
                {status === "idle" && t("voice.idleHint")}
              </span>

              {(status === "thinking" || status === "speaking") && (
                <button
                  type="button"
                  onClick={stopEverything}
                  aria-label={t("tts.stop")}
                  className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 transition-colors"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
