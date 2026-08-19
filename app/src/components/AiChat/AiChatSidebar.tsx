import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { ChatSessionItem } from "@/hooks/useDB";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Archive, ArchiveRestore, CalendarRange, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import { ListPanelEdgeHandle } from "@/components/shared/ListPanelEdgeHandle";

/** Drag range for the resizable sidebar. Narrow enough that a title still
 *  reads, wide enough to not eat the conversation column on a small window. */
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;

/** Plain ghost icon button, same weight as the search toggle beside it — a
 *  tinted pill here was the loudest thing on a screen whose job is to be
 *  quiet: a sidebar exists so the conversation beside it can be read. */
const NEW_BUTTON_CLASS =
  "h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground";

/** Heading, and — when there is anything archived — a switch between the two
 *  lists. A quiet uppercase label rather than a bold underlined tab: the
 *  section name should read like "Chats and tasks" does above Claude's own
 *  list, not compete with the row titles below it for weight. */
function ListTab({
  label, active, onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      aria-pressed={active}
      className={`h-auto min-w-0 max-w-full truncate rounded px-0 py-0 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:bg-transparent ${
        active
          ? "text-muted-foreground hover:text-muted-foreground"
          : "text-muted-foreground/50 hover:text-muted-foreground"
      }`}
    >
      {label}
    </Button>
  );
}

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
  /** Expanded width in px, for the "inline" variant only — the drawer fills
   *  its own fixed-position overlay host and the collapsed rail has a fixed
   *  width, so neither is resizable. Uncontrolled (falls back to the 2/3-of-
   *  the-other-panels default) when the caller doesn't drive it. */
  width?: number;
  onWidthChange?: (width: number) => void;
}

export function AiChatSidebar({
  displaySessions, archivedSessions, searchQuery, onSearchChange,
  dateFrom, dateTo, onDateRangeChange,
  activeId, onSwitchSession, onDeleteSession, onToggleArchived, onTogglePinned, onRenameSession,
  onNewChat, collapsed, onToggleCollapsed, variant = "inline", onRequestClose,
  width = 213, onWidthChange,
}: Props) {
  const t = useT();
  const hasCustomAppBackground = useSettingsStore((state) => !!state.appBackgroundImage && state.appBackgroundVisible);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Which of the two lists is showing, not whether a footer section is open. */
  const [showArchive, setShowArchive] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  // Live width while a drag is in flight — kept separate from the persisted
  // `width` prop so every pointermove doesn't round-trip through the parent
  // (and its localStorage write) before the panel visibly follows the cursor.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const resizeRef = React.useRef<{ startX: number; origWidth: number } | null>(null);

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, origWidth: width };
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, r.origWidth + (e.clientX - r.startX)));
    setDragWidth(next);
  };
  const onResizePointerUp = () => {
    if (resizeRef.current && dragWidth !== null) onWidthChange?.(dragWidth);
    resizeRef.current = null;
    setDragWidth(null);
  };
  const displayWidth = dragWidth ?? width;

  /** Derived, not stored: the last archived conversation can be restored or
   *  deleted while its list is showing, and a stored flag would leave the panel
   *  on an empty view whose tab has just disappeared — with no way back. */
  const archiveView = showArchive && archivedSessions.length > 0;
  const shownSessions = archiveView ? archivedSessions : displaySessions;

  /** Closing the finder clears it. A filter that is still narrowing the list
   *  from behind a collapsed control is a list that is lying about what it
   *  holds — and the reason the row would have to grow a "filters active" dot
   *  in the first place. */
  const toggleFind = () => {
    setFindOpen((open) => {
      if (open) {
        if (searchQuery) onSearchChange("");
        if (dateFrom || dateTo) onDateRangeChange("", "");
        setDateOpen(false);
      }
      return !open;
    });
  };


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
      // The active row is marked by the bar drawn below, not by a leading icon.
      // Every row carried the same chat glyph, which is the definition of
      // decoration: identical on every row, it distinguished nothing and cost
      // the title 22px of the panel's width on all of them.
      className={`group relative flex h-10 lg:h-9 items-center gap-2 pl-3 pr-2.5 mx-1 rounded-lg cursor-pointer transition-colors ${
        session.id === activeId
          ? "bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-fg))] before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
          : "text-[hsl(var(--sidebar-foreground))] hover:bg-muted"
      }`}
    >
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
          <DropdownMenuItem onSelect={() => onTogglePinned(session.id, !session.pinned)}>
            {session.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {t(session.pinned ? "aichat.unpin" : "aichat.pin")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenamingId(session.id)}>
            <Pencil className="h-3.5 w-3.5" /> {t("aichat.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleArchived(session.id, !archived)}>
            {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {t(archived ? "aichat.unarchive" : "aichat.archive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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

  const panel = (
    <aside
      className={variant === "drawer"
        ? `flex h-full w-full flex-col ${hasCustomAppBackground ? "bg-transparent" : "bg-card"}`
        : `relative shrink-0 border-r border-border/60 flex flex-col ${
            dragWidth !== null ? "" : "transition-[width] duration-300 ease-out"
          } ${hasCustomAppBackground ? "bg-transparent" : "backdrop-blur-xl bg-card"}`}
      style={variant === "inline" ? { width: displayWidth } : undefined}
    >
      {variant === "inline" && (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          title={t("aichat.resizeSidebar")}
          className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/40 active:after:bg-primary/60"
        />
      )}
      {/* One block, one border. This was three stacked bands — a header, a
        * filter box, then the list — each with its own rule, which sliced a
        * 320px panel into strips before a single conversation appeared. */}
      <div className="border-b border-border">
          <div className="flex h-8 items-center gap-2 px-3">
            {variant === "drawer" && (
              <Button variant="ghost" size="icon" onClick={onRequestClose} className="-ml-1 h-6 w-6 shrink-0" title={t("aichat.closeSessions")} aria-label={t("aichat.closeSessions")}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* The heading. "Chats" is a truncating label — at the panel's
              * narrower widths there isn't room for two full text tabs side
              * by side without them overlapping the search/new buttons — so
              * Archived (a secondary view) is an icon toggle instead of a
              * second label competing for the same line. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ListTab label={t("aichat.chats")} active={!archiveView} onSelect={() => setShowArchive(false)} />
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">{shownSessions.length}</span>
              {archivedSessions.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowArchive((v) => !v)}
                  aria-pressed={archiveView}
                  title={t("aichat.archivedTab")}
                  aria-label={t("aichat.archivedTab")}
                  className={`h-5 w-5 shrink-0 rounded ${archiveView ? "text-primary hover:text-primary" : "text-muted-foreground/50 hover:text-foreground"}`}
                >
                  <Archive className="h-3 w-3" />
                </Button>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFind}
              title={t("aichat.searchPlaceholder")}
              aria-label={t("aichat.searchPlaceholder")}
              aria-expanded={findOpen}
              className={`relative h-6 w-6 shrink-0 ${findOpen ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" onClick={onNewChat} className={NEW_BUTTON_CLASS} title={t("aichat.newChat")} aria-label={t("aichat.newChat")}>
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Only while you are actually filtering. A date range you never use
            * had a permanent full-width row at the same weight as search. */}
          {findOpen && (
            <div className="space-y-2 px-3 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") toggleFind(); }}
                  placeholder={t("aichat.searchPlaceholder")}
                  // 16px below lg: iOS would otherwise zoom the page on focus.
                  className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-8 text-[16px] lg:text-xs placeholder:text-muted-foreground/40 focus:outline-hidden focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setDateOpen((open) => !open)}
                  title={t("aichat.dateRange")}
                  aria-label={t("aichat.dateRange")}
                  aria-expanded={dateOpen}
                  className={`absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md transition-colors ${
                    dateOpen || dateFrom || dateTo
                      ? "text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <CalendarRange className="h-3 w-3" />
                </button>
              </div>
              {(dateOpen || dateFrom || dateTo) && (
                <DateRangePicker
                  from={dateFrom}
                  to={dateTo}
                  onChange={(from, to) => onDateRangeChange(from, to)}
                  placeholder={t("aichat.dateRange")}
                  className="w-full"
                />
              )}
            </div>
          )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {shownSessions.length === 0 && (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center">
            {searchQuery || dateFrom || dateTo ? t("aichat.noResults") : t("aichat.noSessions")}
          </p>
        )}
        {shownSessions.map((session) => (
          <SessionRow key={session.id} session={session} archived={archiveView} />
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
    </aside>
  );

  if (variant !== "inline") return panel;

  return (
    <div className="relative flex h-full shrink-0">
      {!collapsed && panel}
      <ListPanelEdgeHandle
        edge="leading"
        collapsed={collapsed}
        onClick={onToggleCollapsed}
        label={collapsed ? t("aichat.sidebarExpand") : t("aichat.sidebarCollapse")}
        top="top-10"
      />
    </div>
  );
}
