import React, { useRef } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { useNavStore } from "@/store/navStore";
import { useT } from "@/hooks/useT";

const AiChatPage = React.lazy(() =>
  import("./AiChatPage").then((m) => ({ default: m.AiChatPage })));
const ChatFallback = () => (
  <div className="flex h-full items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

interface Props {
  open: boolean;
  onClose: () => void;
  /** Session to switch to as soon as the chat mounts — e.g. the reader's "Open in AI Chat" action. */
  sessionId?: string;
}

/** Full AI Chat UI in a large modal so a "Learn with AI chat" result can be
 *  read without leaving the article/feed the user was on. A thin chrome bar
 *  (expand + close) sits above AiChatPage rather than floating over it —
 *  AiChatPage's own header is already busy with session/provider controls in
 *  the top-right corner. Renders a fresh AiChatPage each time it opens;
 *  that's fine since chat sessions are persisted (see useAiChatSession's own
 *  DB-backed session list) — closing and reopening just remounts, not loses.
 *
 *  Vertical centering is top-[7.5vh] (the leftover of h-[85vh]) instead of
 *  top-1/2 -translate-y-1/2: percentage translates land the layer on
 *  fractional pixels and WebKitGTK renders all the text inside blurry. */
export function AiChatModal({ open, onClose, sessionId }: Props) {
  const t = useT();
  // The session shown may drift from the `sessionId` prop as the user clicks
  // around the modal's sidebar — AiChatPage reports the live one up here so
  // the expand button opens what's actually on screen.
  const activeIdRef = useRef<string | null>(sessionId ?? null);

  if (!open) return null;

  const expandToFullPage = () => {
    useNavStore.getState().openChatSession(activeIdRef.current ?? undefined);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-none" className="w-[90vw] h-[85vh] top-[7.5vh] flex flex-col overflow-hidden p-0">
      <div className="flex shrink-0 items-center justify-end gap-1 px-2 py-1.5 border-b border-border">
        <Button
          variant="ghost"
          onClick={expandToFullPage}
          title={t("aichat.expandToPage")}
          aria-label={t("aichat.expandToPage")}
          className="w-7 h-7 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          onClick={onClose}
          className="w-7 h-7 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <React.Suspense fallback={<ChatFallback />}>
          <AiChatPage initialSessionId={sessionId} onActiveIdChange={(id) => { activeIdRef.current = id; }} />
        </React.Suspense>
      </div>
    </Dialog>
  );
}
