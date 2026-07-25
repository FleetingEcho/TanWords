import React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { AiChatPage } from "./AiChatPage";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Session to switch to as soon as the chat mounts — e.g. the reader's "Open in AI Chat" action. */
  sessionId?: string;
}

/** Full AI Chat UI in a large modal so a "Learn with AI chat" result can be
 *  read without leaving the article/feed the user was on. A thin chrome bar
 *  (just a close button) sits above AiChatPage rather than floating over it —
 *  AiChatPage's own header is already busy with session/provider controls in
 *  the top-right corner. Renders a fresh AiChatPage each time it opens;
 *  that's fine since chat sessions are persisted (see useAiChatSession's own
 *  DB-backed session list) — closing and reopening just remounts, not loses. */
export function AiChatModal({ open, onClose, sessionId }: Props) {
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-none" className="w-[90vw] h-[85vh] top-1/2 -translate-y-1/2 flex flex-col overflow-hidden p-0">
      <div className="flex shrink-0 items-center justify-end px-2 py-1.5 border-b border-border">
        <Button
          variant="ghost"
          onClick={onClose}
          className="w-7 h-7 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <AiChatPage initialSessionId={sessionId} />
      </div>
    </Dialog>
  );
}
