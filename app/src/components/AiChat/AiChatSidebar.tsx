import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { ChatSessionItem } from "@/hooks/useDB";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { ChevronsLeft, ChevronsRight, MessageSquarePlus } from "lucide-react";

interface Props {
  displaySessions: ChatSessionItem[];
  grouped: [string, ChatSessionItem[]][];
  searchQuery: string;
  onSearchChange: (v: string) => void;
  activeId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onNewChat: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function AiChatSidebar({
  displaySessions, grouped, searchQuery, onSearchChange,
  activeId, onSwitchSession, onDeleteSession, onNewChat, collapsed, onToggleCollapsed,
}: Props) {
  const t = useT();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <aside className={`${collapsed ? "w-[58px]" : "w-72"} shrink-0 border-r border-border/60 flex flex-col bg-[hsl(var(--sidebar))]/80 backdrop-blur-xl transition-[width] duration-300 ease-out`}>
      <div className="p-3 pb-2 border-b border-border">
        <div className={`mb-2 flex ${collapsed ? "justify-center" : "justify-end"}`}>
          <Button variant="ghost" onClick={onToggleCollapsed} className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:text-foreground" title={collapsed ? t("aichat.sidebarExpand") : t("aichat.sidebarCollapse")}>
            {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <Button
          onClick={onNewChat}
          className={`h-9 w-full flex items-center ${collapsed ? "justify-center px-0" : "justify-start gap-2 px-3"} rounded-xl text-sm font-medium bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors`}
          title={t("aichat.newChat")}
        >
          <MessageSquarePlus className="w-4 h-4 shrink-0" />
          {!collapsed && t("aichat.newChat")}
        </Button>
      </div>

      {!collapsed && <div className="px-3 py-2 border-b border-border">
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
      </div>}

      {!collapsed && <div className="flex-1 overflow-y-auto py-1">
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
      </div>}

      {collapsed && <div className="flex-1 flex flex-col items-center gap-2 py-3">
        {displaySessions.slice(0, 8).map((session) => <Button key={session.id} variant="ghost" onClick={() => onSwitchSession(session.id)} title={session.title} className={`h-8 w-8 rounded-xl p-0 text-[11px] font-semibold ${session.id === activeId ? "bg-primary/12 text-primary ring-1 ring-primary/20" : "text-muted-foreground"}`}>{session.title.trim().slice(0, 1).toUpperCase()}</Button>)}
      </div>}

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
    </aside>
  );
}
