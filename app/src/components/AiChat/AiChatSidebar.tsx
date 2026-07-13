import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { ChatSessionItem } from "@/hooks/useDB";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";

interface Props {
  displaySessions: ChatSessionItem[];
  grouped: [string, ChatSessionItem[]][];
  searchQuery: string;
  onSearchChange: (v: string) => void;
  activeId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onNewChat: () => void;
}

export function AiChatSidebar({
  displaySessions, grouped, searchQuery, onSearchChange,
  activeId, onSwitchSession, onDeleteSession, onNewChat,
}: Props) {
  const t = useT();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <div className="w-80 shrink-0 border-r border-border flex flex-col bg-[hsl(var(--sidebar))]">
      <div className="p-3 pb-2 border-b border-border">
        <Button
          onClick={onNewChat}
          className="h-auto w-full flex items-center justify-start gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
            <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
          </svg>
          {t("aichat.newChat")}
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50">
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" strokeLinecap="round" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("aichat.searchPlaceholder")}
            className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-input bg-background placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {displaySessions.length === 0 && (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center">
            {searchQuery ? t("aichat.noResults") : t("aichat.noSessions")}
          </p>
        )}
        {grouped.map(([group, items]) => (
          <div key={group} className="mb-2">
            <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              {t(`aichat.group.${group}`)}
            </p>
            {items.map((s) => (
              <div
                key={s.id}
                onClick={() => onSwitchSession(s.id)}
                className={`group relative flex items-start gap-1 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                  s.id === activeId
                    ? "bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-fg))]"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-muted"
                }`}
              >
                <span className="flex-1 text-xs leading-snug line-clamp-2 break-words min-w-0">{s.title}</span>
                <Button
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteId(s.id); }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 w-4 h-4 p-0 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-all mt-0.5"
                >
                  <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                    <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <ConfirmModal
        open={pendingDeleteId !== null}
        title={t("aichat.deleteConfirmTitle")}
        message={t("aichat.deleteConfirmMessage")}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={(e) => {
          if (pendingDeleteId) onDeleteSession(pendingDeleteId, e);
          setPendingDeleteId(null);
        }}
      />
    </div>
  );
}
