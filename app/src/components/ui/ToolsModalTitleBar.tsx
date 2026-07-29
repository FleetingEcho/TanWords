import { Maximize2, Minimize2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

type ToolsModalTab = "documents" | "chat" | "word";

interface ToolsModalTitleBarProps {
  activeTab: ToolsModalTab;
  setActiveTab: (tab: ToolsModalTab) => void;
  isVocabPage: boolean;
  closeModal: () => void;
  maximized: boolean;
  toggleMaximized: () => void;
  dragging: boolean;
  onTitlePointerDown: (e: React.PointerEvent) => void;
  onTitlePointerMove: (e: React.PointerEvent) => void;
  onTitlePointerUp: () => void;
}

/** Title bar — draggable handle, tab switcher, maximize and close buttons. */
export function ToolsModalTitleBar({
  activeTab,
  setActiveTab,
  isVocabPage,
  closeModal,
  maximized,
  toggleMaximized,
  dragging,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
}: ToolsModalTitleBarProps) {
  const t = useT();

  const tabs: ToolsModalTab[] = isVocabPage ? ["documents", "chat", "word"] : ["documents", "chat"];

  return (
    <div
      className={`flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border select-none ${
        maximized ? "" : dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDown={onTitlePointerDown}
      onPointerMove={onTitlePointerMove}
      onPointerUp={onTitlePointerUp}
      onPointerCancel={onTitlePointerUp}
      onDoubleClick={toggleMaximized}
    >
      {/* Drag handle dots */}
      {!maximized && (
        <svg viewBox="0 0 12 12" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 pointer-events-none">
          <circle cx="3" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" />
          <circle cx="3" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
          <circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
        </svg>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5" onDoubleClick={(e) => e.stopPropagation()}>
        {tabs.map((tab) => (
          <Button
            key={tab}
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }}
            className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-md transition-colors hover:bg-transparent ${
              activeTab === tab
                ? "bg-background text-foreground shadow-sm hover:bg-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`tools.${tab}`)}
          </Button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Maximize / restore */}
      <Button
        variant="ghost"
        onClick={(e) => { e.stopPropagation(); toggleMaximized(); }}
        title={maximized ? t("tools.restore") : t("tools.maximize")}
        aria-label={maximized ? t("tools.restore") : t("tools.maximize")}
        className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </Button>

      {/* Close button */}
      <Button
        variant="ghost"
        onClick={(e) => { e.stopPropagation(); closeModal(); }}
        title={t("tools.close")}
        className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </Button>
    </div>
  );
}
