import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { ChatSessionItem } from "@/hooks/useDB";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Archive, ArchiveRestore, ChevronDown, ChevronsLeft, ChevronsRight, MessageSquare, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { LIST_PANEL_WIDTH, LIST_PANEL_COLLAPSED_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";

/** Same compact pill as Documents' "+ New Doc" button (DocSelector) — kept in
 *  one row with the collapse toggle instead of stacking a full-width button below it. */
const NEW_BUTTON_CLASS = "h-6 px-2.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90";

/** `updated_at` sliced to its date, said the short way.
 *
 *  The list used to print the raw `2026-07-31` under every title. Ten glyphs
 *  of mostly-identical text on its own line, once per row — it doubled each
 *  row's height to say something that only matters as "how long ago", and the
 *  shared `2026-` prefix carried no information at all.
 *
 *  Compares the same `slice(0, 10)` the list already displayed rather than
 *  parsing the timestamp, so this changes how the date reads and nothing about
 *  which day it names. */
function formatSessionDate(t: (k: string) => string, updatedAt: string): string {
  const key = updatedAt.slice(0, 10);
  const at = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (key === at(0)) return t("aichat.today");
  if (key === at(1)) return t("aichat.yesterday");
  // Same calendar year: the year is shared by every row, so drop it.
  if (key.slice(0, 4) === at(0).slice(0, 4)) return key.slice(5);
  return key;
}

interface Props {
  displaySessions: ChatSessionItem[];
  archivedSessions: ChatSessionItem[];
  searchQuery: string;
  onSearchChange: (v: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateRangeChange: (from: string, to: string) => void;
  activeId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onToggleArchived: (id: string, archived: boolean) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onRenameSession: (id: string, title: string) => void;
  onNewChat: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** "inline" is the desktop column; "drawer" is the <lg overlay panel, which
   *  fills its fixed-position host and offers a close button instead of a
   *  collapse rail. */
  variant?: "inline" | "drawer";
  onRequestClose?: () => void;
}

export function AiChatSidebar({
  displaySessions, archivedSessions, searchQuery, onSearchChange,
  dateFrom, dateTo, onDateRangeChange,
  activeId, onSwitchSession, onDeleteSession, onToggleArchived, onTogglePinned, onRenameSession,
  onNewChat, collapsed, onToggleCollapsed, variant = "inline", onRequestClose,
}: Props) {
  const t = useT();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const commitRename = (id: string, value: string) => {
    setRenamingId(null);
    const title = value.trim();
    if (title) onRenameSession(id, title);
  };

  /** One row, in either list. Conversations are listed newest-first and dated
   *  individually — the old Today/Yesterday/This week headers repeated the
   *  same information as the timestamps while breaking the list into stubs. */
  const SessionRow = ({ session, archived }: { session: ChatSessionItem; archived: boolean }) => (
    <div
      onClick={() => onSwitchSession(session.id)}
      title={session.title}
      className={`group relative flex h-10 lg:h-9 items-center gap-2 px-2.5 mx-1 rounded-lg cursor-pointer transition-colors ${
        session.id === activeId
          ? "bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-fg))]"
          : "text-[hsl(var(--sidebar-foreground))] hover:bg-muted"
      }`}
    >
      {/* Same glyph the collapsed rail uses, so a conversation looks like the
        * same object whichever width the panel is at. */}
      <MessageSquare
        className={`h-3.5 w-3.5 shrink-0 ${session.id === activeId ? "text-primary" : "text-muted-foreground/50"}`}
      />
      <span className="min-w-0 flex-1">
        {renamingId === session.id ? (
          // Uncontrolled on purpose: SessionRow is redefined every parent
          // render, so a controlled input would remount (and drop focus) on
          // each keystroke. Commit on Enter/blur, cancel on Escape.
          <input
            autoFocus
            defaultValue={session.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(session.id, e.currentTarget.value);
              else if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={(e) => commitRename(session.id, e.currentTarget.value)}
            className="w-full h-6 px-1.5 text-[16px] lg:text-xs rounded-md border border-primary/40 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/30"
          />
        ) : (
          // One line, truncated: `line-clamp-2` let every row pick its own
          // height, so the list came out ragged. The full title is in the
          // row's tooltip.
          <span className="block truncate text-xs leading-none">{session.title}</span>
        )}
      </span>
      {session.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-primary/70" />}
      {/* Date and menu share one slot, so revealing the menu on hover shifts
        * nothing. The date also yields while the menu is open — without the
        * `group-has-` clause it reappears under the popup as soon as the
        * pointer leaves the row. */}
      <span className="relative flex w-16 shrink-0 items-center justify-end">
        <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/60 transition-opacity group-hover:opacity-0 group-has-data-[state=open]:opacity-0">
          {formatSessionDate(t, session.updated_at)}
        </span>
        <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            onClick={(e) => e.stopPropagation()}
            title={t("aichat.sessionMenu")}
            // Touch has no hover — the row menu stays visible below lg.
            className="absolute right-0 h-5 w-5 shrink-0 p-0 text-muted-foreground lg:opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100 hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onClick={(e) => e.stopPropagation()}
          // Radix restores focus to the trigger on close, which would steal
          // focus from the freshly opened rename input.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem onSelect={() => setRenamingId(session.id)}>
            <Pencil className="h-3.5 w-3.5" /> {t("aichat.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onTogglePinned(session.id, !session.pinned)}>
            {session.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {t(session.pinned ? "aichat.unpin" : "aichat.pin")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleArchived(session.id, !archived)}>
            {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {t(archived ? "aichat.unarchive" : "aichat.archive")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setPendingDeleteId(session.id)}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );

  return (
    <aside className={variant === "drawer"
      ? "flex h-full w-full flex-col bg-card"
      : `${collapsed ? LIST_PANEL_COLLAPSED_WIDTH : LIST_PANEL_WIDTH} shrink-0 border-r border-border/60 flex flex-col backdrop-blur-xl transition-[width] duration-300 ease-out bg-card`}>
      {collapsed ? (
        <div className="p-3 pb-2 border-b border-border flex flex-col items-center gap-2">
          <Button variant="ghost" onClick={onToggleCollapsed} className={`h-7 w-7 p-0 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("aichat.sidebarExpand")}>
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={onNewChat} className="h-7 w-7 p-0 rounded-lg bg-primary text-white hover:bg-primary/90" title={t("aichat.newChat")}>
            <MessageSquarePlus className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="px-3 pt-4 pb-2 border-b border-border">
          <div className="flex items-center justify-between">
            {variant === "drawer" ? (
              <Button variant="ghost" size="icon" onClick={onRequestClose} className="h-6 w-6" title={t("aichat.closeSessions")} aria-label={t("aichat.closeSessions")}>
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : (
            <Button variant="ghost" size="icon" onClick={onToggleCollapsed} className={`h-6 w-6 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("aichat.sidebarCollapse")}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            )}
            <Button onClick={onNewChat} className={NEW_BUTTON_CLASS}>+ {t("aichat.newChat")}</Button>
          </div>
        </div>
      )}

      {!collapsed && <div className="space-y-2 px-3 py-2 border-b border-border">
        <div className="relative">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50">
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" strokeLinecap="round" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("aichat.searchPlaceholder")}
            // 16px below lg: iOS would otherwise zoom the page on focus.
            className="w-full h-7 pl-7 pr-2 text-[16px] lg:text-xs rounded-md border border-input bg-background placeholder:text-muted-foreground/40 focus:outline-hidden focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(from, to) => onDateRangeChange(from, to)}
          placeholder={t("aichat.dateRange")}
          className="w-full"
        />
      </div>}

      {!collapsed && <div className="flex-1 overflow-y-auto py-1">
        {displaySessions.length === 0 && (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center">
            {searchQuery || dateFrom || dateTo ? t("aichat.noResults") : t("aichat.noSessions")}
          </p>
        )}
        {displaySessions.map((session) => (
          <SessionRow key={session.id} session={session} archived={false} />
        ))}

        {archivedSessions.length > 0 && (
          <div className="mt-2 border-t border-border/60 pt-1">
            <button
              onClick={() => setShowArchive((v) => !v)}
              className="flex w-full items-center gap-1.5 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showArchive ? "" : "-rotate-90"}`} />
              {t("aichat.archived", { n: archivedSessions.length })}
            </button>
            {showArchive && archivedSessions.map((session) => (
              <SessionRow key={session.id} session={session} archived />
            ))}
          </div>
        )}
      </div>}

      {/* A chat glyph per session, not the title's first letter. Initials only
        * read as initials when they mean something — here they were arbitrary
        * ("S", "M", "S"), told you nothing about which chat was which, and made
        * the rail look like a column of stray characters. The icon says "chat"
        * and the title lives in the tooltip; the active one is marked by its
        * highlight. */}
      {collapsed && <div className="flex-1 flex flex-col items-center gap-2 py-3">
        {displaySessions.slice(0, 8).map((session) => (
          <Button
            key={session.id}
            variant="ghost"
            onClick={() => onSwitchSession(session.id)}
            title={session.title}
            aria-label={session.title}
            className={`h-8 w-8 rounded-xl p-0 ${session.id === activeId ? "bg-primary/12 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:text-foreground"}`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        ))}
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
