import { useState, useEffect, useRef, useCallback } from "react";
import { DisplayItem, ATTACH_THRESHOLD } from "../aiChatHelpers";

/** Composer input, the pasted-attachment affordance, and the message-list
 * scroll behavior (auto-follow while streaming, "scroll to bottom" button).
 * Kept separate from session/send state since none of this needs to know
 * which session is open or how a message is delivered. */
export function useChatComposer(displayItems: DisplayItem[], streaming: boolean) {
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [showAttachment, setShowAttachment] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  // False once the user scrolls away from the bottom, so a long answer that
  // keeps streaming can't yank them back to it while they're reading earlier
  // parts of the conversation.
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    const onScroll = () => {
      const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      stickToBottomRef.current = atBottom;
      setShowScrollToBottom(!atBottom);
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  // Follows the answer as it streams, not just when a new bubble appears: a
  // streaming turn grows the *content* of the last item without changing the
  // item count, so keying this on length alone left the user scrolling by
  // hand for the whole response. Jumps instantly while streaming — a smooth
  // animation every 50ms commit never finishes and looks like drift.
  const tail = displayItems[displayItems.length - 1];
  const tailLength = tail?.kind === "message" ? tail.msg.content.length : 0;
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [displayItems.length, tailLength, streaming]);

  const scrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  /** Switching sessions (or starting a new one) should land back at the
   *  bottom with a clean composer, same as opening the page fresh. */
  const resetForSessionChange = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setInput("");
    setAttachment(null);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // Cap matches the composer's max-h; min-h keeps it from shrinking below
    // the resting size, so short messages don't collapse the box.
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [input]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (text.length > ATTACH_THRESHOLD) {
      e.preventDefault();
      setAttachment((prev) => (prev ? `${prev}\n\n${text}` : text));
    }
  };

  return {
    input, setInput, attachment, setAttachment, showAttachment, setShowAttachment,
    showScrollToBottom, scrollToBottom,
    bottomRef, scrollHostRef, stickToBottomRef, textareaRef,
    handlePaste, resetForSessionChange,
  };
}

export type ChatComposerState = ReturnType<typeof useChatComposer>;
