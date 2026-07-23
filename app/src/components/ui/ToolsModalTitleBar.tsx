import { useT } from "@/hooks/useT";
import { useAiChatSession } from "@/components/AiChat/useAiChatSession";
import { ChatSessionItem } from "@/hooks/useDB";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ToolsModalTab = "documents" | "chat" | "word";

interface ToolsModalTitleBarProps {
  activeTab: ToolsModalTab;
  setActiveTab: (tab: ToolsModalTab) => void;
  isVocabPage: boolean;
  chat: ReturnType<typeof useAiChatSession>;
  allSessions: ChatSessionItem[];
  closeModal: () => void;
  dragging: boolean;
  onTitlePointerDown: (e: React.PointerEvent) => void;
  onTitlePointerMove: (e: React.PointerEvent) => void;
  onTitlePointerUp: () => void;
}

/** Title bar — draggable handle, tab switcher, AI chat session controls, and close button. */
export function ToolsModalTitleBar({
  activeTab,
  setActiveTab,
  isVocabPage,
  chat,
  allSessions,
  closeModal,
  dragging,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
}: ToolsModalTitleBarProps) {
  const t = useT();

  return (
    <div
      className={`flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border select-none ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDown={onTitlePointerDown}
      onPointerMove={onTitlePointerMove}
      onPointerUp={onTitlePointerUp}
      onPointerCancel={onTitlePointerUp}
    >
      {/* Drag handle dots */}
      <svg viewBox="0 0 12 12" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 pointer-events-none">
        <circle cx="3" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" />
        <circle cx="3" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
        <circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
      </svg>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
        <Button
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); setActiveTab("documents"); }}
          className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-md transition-colors hover:bg-transparent ${
            activeTab === "documents"
              ? "bg-background text-foreground shadow-sm hover:bg-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("tools.documents")}
        </Button>
        <Button
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); setActiveTab("chat"); }}
          className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-md transition-colors hover:bg-transparent ${
            activeTab === "chat"
              ? "bg-background text-foreground shadow-sm hover:bg-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("tools.chat")}
        </Button>
        {isVocabPage && (
          <Button
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setActiveTab("word"); }}
            className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-md transition-colors hover:bg-transparent ${
              activeTab === "word"
                ? "bg-background text-foreground shadow-sm hover:bg-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("tools.word")}
          </Button>
        )}
      </div>

      {/* AI Chat controls (only visible on chat tab) */}
      {activeTab === "chat" && (
        <div className="flex items-center gap-1.5 ml-2" onPointerDown={(e) => e.stopPropagation()}>
          {/* Session selector dropdown */}
          <Select
            value={chat.activeId ?? undefined}
            onValueChange={(id) => {
              if (id && id !== chat.activeId) chat.switchSession(id);
            }}
            disabled={allSessions.length === 0 && !chat.activeId}
          >
            <SelectTrigger className="h-7 w-auto gap-1 px-2 text-[10px] rounded-lg border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 max-w-[130px] [&_svg]:h-3 [&_svg]:w-3">
              <SelectValue placeholder={t("aichat.newChat")} />
            </SelectTrigger>
            <SelectContent>
              {allSessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.title || t("aichat.newChat")}</SelectItem>
              ))}
              {chat.activeId && !allSessions.find((s) => s.id === chat.activeId) && (
                <SelectItem value={chat.activeId}>{chat.activeTitle || t("aichat.newChat")}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            onClick={() => chat.startNew()}
            className="h-7 px-2.5 rounded-lg text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
          >
            {t("tools.newChat")}
          </Button>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Close button */}
      <Button
        variant="ghost"
        onClick={(e) => { e.stopPropagation(); closeModal(); }}
        title={t("tools.close")}
        className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </Button>
    </div>
  );
}
