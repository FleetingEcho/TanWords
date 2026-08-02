import React, { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { Markdown } from "./Markdown";
import { Button } from "@/components/ui/button";
import { Pencil, RotateCw } from "lucide-react";
import { AI_MESSAGE_ATTR } from "@/components/shared/SelectionAsk";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  msg: AiMessage;
  /** When true, renders smaller text and tighter spacing for embedded panels */
  compact?: boolean;
  /** Show typing indicator dots instead of content (last AI message while streaming) */
  isTyping?: boolean;
  /** When true, fills the max-w cap instead of shrink-wrapping to content —
   *  used for the message immediately following a tool card so the two line
   *  up as one continuous block instead of two independently-sized boxes. */
  fillCardWidth?: boolean;
  /** Position in the conversation, passed back to onEdit. */
  index?: number;
  /** Pull this user message back into the composer, dropping everything after
   *  it — set only for user messages, and only when nothing is streaming.
   *  Takes the index rather than closing over it so the callback identity
   *  stays stable and React.memo keeps holding: a streaming answer commits
   *  every 50ms, and a fresh closure per message would re-render the whole
   *  transcript each time. */
  onEdit?: (index: number) => void;
  /** Re-run the last user turn — set only on the final assistant message. */
  onRegenerate?: () => void;
  /** Custom renderer for blockquotes, e.g. Speaking Coach's TTS/save lines. */
  renderBlockquote?: (lines: string[], key: string) => React.ReactNode;
  /** When set, English words in assistant markdown open the word lookup modal. */
  onWordClick?: (word: string) => void;
}

/** User messages longer than this render collapsed (pasted articles etc.) */
const COLLAPSE_THRESHOLD = 700;
const COLLAPSE_PREVIEW = 350;

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export const MessageBubble = React.memo(function MessageBubble({ msg, compact = false, isTyping = false, fillCardWidth = false, index = 0, onEdit, onRegenerate, renderBlockquote, onWordClick }: Props) {
  const t = useT();
  const userAvatar = useSettingsStore((s) => s.userAvatar);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("aichat.copyFailed"));
    }
  };

  const textSize = compact ? "text-xs" : "text-sm";
  const avatarSize = compact ? "w-8 h-8 text-xs" : "w-8 h-8 text-xs lg:w-10 lg:h-10 lg:text-sm";

  const isLongUserMsg = msg.role === "user" && msg.content.length > COLLAPSE_THRESHOLD;

  return (
    <div className={`flex gap-2.5 lg:gap-3 group ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      {msg.role === "assistant" && (
        <div
          className={`${avatarSize} rounded-xl bg-linear-to-br from-primary to-primary/80 ring-1 ring-primary/30 flex items-center justify-center font-semibold text-primary-foreground shrink-0 mt-1 shadow-md`}
        >
          AI
        </div>
      )}

      <div
        {...(msg.role === "assistant" ? { [AI_MESSAGE_ATTR]: "" } : {})}
        className={`relative max-w-[min(82%,48rem)] max-lg:max-w-[88%] ${fillCardWidth ? "w-full" : ""} rounded-[20px] px-4 py-3 ${textSize} leading-7 shadow-xs ${
          msg.role === "user"
            ? "bg-linear-to-br from-primary to-primary/90 text-primary-foreground rounded-br-md shadow-primary/10"
            : "border border-border/55 bg-card/80 text-foreground rounded-bl-md backdrop-blur-xs"
        }`}
      >
        {isTyping ? (
          <span className="flex gap-1 items-center py-0.5">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        ) : msg.role === "assistant" ? (
          <Markdown text={msg.content} renderBlockquote={renderBlockquote} onWordClick={onWordClick} />
        ) : isLongUserMsg && !expanded ? (
          <>
            <p className="whitespace-pre-wrap">{msg.content.slice(0, COLLAPSE_PREVIEW)}…</p>
            <Button
              variant="link"
              onClick={() => setExpanded(true)}
              className="h-auto p-0 mt-1.5 text-[11px] font-semibold text-primary-foreground underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              {t("aichat.expand", { n: countWords(msg.content) })}
            </Button>
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap">{msg.content}</p>
            {isLongUserMsg && (
              <Button
                variant="link"
                onClick={() => setExpanded(false)}
                className="h-auto p-0 mt-1.5 text-[11px] font-semibold text-primary-foreground underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                {t("aichat.collapse")}
              </Button>
            )}
          </>
        )}

        {!isTyping && msg.content && (
          <div className={`absolute -top-2 ${msg.role === "user" ? "-left-2" : "-right-2"} flex items-center gap-1 max-lg:opacity-90 opacity-0 group-hover:opacity-100 transition-opacity`}>
          {onEdit && (
            <Button
              variant="ghost"
              onClick={() => onEdit(index)}
              className="w-5 h-5 p-0 rounded-full bg-background border border-border flex items-center justify-center shadow-xs hover:bg-background"
              title={t("aichat.editMessage")}
            >
              <Pencil className="w-2.5 h-2.5 text-muted-foreground" />
            </Button>
          )}
          {onRegenerate && (
            <Button
              variant="ghost"
              onClick={onRegenerate}
              className="w-5 h-5 p-0 rounded-full bg-background border border-border flex items-center justify-center shadow-xs hover:bg-background"
              title={t("aichat.regenerate")}
            >
              <RotateCw className="w-2.5 h-2.5 text-muted-foreground" />
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={copy}
            className="w-5 h-5 p-0 rounded-full bg-background border border-border flex items-center justify-center shadow-xs hover:bg-background"
            title={t("chat.copy")}
          >
            {copied ? (
              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-green-500">
                <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-muted-foreground">
                <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
                <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            )}
          </Button>
          </div>
        )}
      </div>

      {msg.role === "user" && (
        <div
          className={`${avatarSize} rounded-xl bg-muted ring-1 ring-border flex items-center justify-center shrink-0 mt-1 overflow-hidden shadow-md`}
        >
          {userAvatar ? (
            <img src={userAvatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5 text-muted-foreground">
              <path fillRule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6zm-4.5 8a4.5 4.5 0 019 0H3.5z" />
            </svg>
          )}
        </div>
      )}
    </div>
  );
});
