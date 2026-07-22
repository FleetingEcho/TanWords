import React, { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { Markdown } from "./Markdown";
import { Button } from "@/components/ui/button";

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
}

/** User messages longer than this render collapsed (pasted articles etc.) */
const COLLAPSE_THRESHOLD = 700;
const COLLAPSE_PREVIEW = 350;

export function MessageBubble({ msg, compact = false, isTyping = false }: Props) {
  const t = useT();
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
  const avatarSize = compact ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]";

  const isLongUserMsg = msg.role === "user" && msg.content.length > COLLAPSE_THRESHOLD;

  return (
    <div className={`flex gap-3 group ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      {msg.role === "assistant" && (
        <div
          className={`${avatarSize} rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-primary/15 flex items-center justify-center font-semibold text-primary shrink-0 mt-1 shadow-sm`}
        >
          AI
        </div>
      )}

      <div
        className={`relative max-w-[82%] rounded-[20px] px-4 py-3 ${textSize} leading-7 shadow-sm ${
          msg.role === "user"
            ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground rounded-br-md shadow-primary/10"
            : "border border-border/55 bg-card/80 text-foreground rounded-bl-md backdrop-blur-sm"
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
          <Markdown text={msg.content} />
        ) : isLongUserMsg && !expanded ? (
          <>
            <p className="whitespace-pre-wrap">{msg.content.slice(0, COLLAPSE_PREVIEW)}…</p>
            <Button
              variant="link"
              onClick={() => setExpanded(true)}
              className="h-auto p-0 mt-1.5 text-[11px] font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              {t("aichat.expand", { n: msg.content.length })}
            </Button>
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap">{msg.content}</p>
            {isLongUserMsg && (
              <Button
                variant="link"
                onClick={() => setExpanded(false)}
                className="h-auto p-0 mt-1.5 text-[11px] font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                {t("aichat.collapse")}
              </Button>
            )}
          </>
        )}

        {!isTyping && msg.content && (
          <Button
            variant="ghost"
            onClick={copy}
            className={`absolute -top-2 ${msg.role === "user" ? "-left-2" : "-right-2"} w-5 h-5 p-0 rounded-full bg-background border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-background`}
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
        )}
      </div>

      {msg.role === "user" && (
        <div
          className={`${avatarSize} rounded-xl bg-muted/80 ring-1 ring-border/60 flex items-center justify-center shrink-0 mt-1`}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted-foreground">
            <path fillRule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6zm-4.5 8a4.5 4.5 0 019 0H3.5z" />
          </svg>
        </div>
      )}
    </div>
  );
}
