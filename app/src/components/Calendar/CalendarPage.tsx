import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import type {
  CalendarApi,
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { useIsDark } from "@/hooks/useIsDark";
import { Button } from "@/components/ui/button";
import { CalendarEventDialog, type EventDraft } from "./CalendarEventDialog";
import { colorTokenToHex, colorTokenToTextColor } from "./calendarColors";
import { fcToWire, wireToFc } from "./calendarWire";
import type { CalendarCategoryRow, CalendarEventRow } from "@/hooks/useDB.calendar";

/** A Calendar page backed by FullCalendar, persisting events to the user's
 *  SQLite/libsql database through the same command surface every other
 *  feature uses. Events still belong to a colour "calendar" category (picked
 *  in the event dialog, tints the event) — only the sidebar UI for managing
 *  those categories themselves (create/rename/delete/show-hide) was removed
 *  as unused; the DB layer and Rust commands for it are untouched.
 *
 *  Persistence model: FullCalendar React is a controlled component — events
 *  come from the `events` prop (mapped from DB rows). Every user interaction
 *  triggers an explicit DB write then a reload:
 *    - drag-to-create  → `select` callback → open create dialog pre-filled
 *    - click an event  → `eventClick` → open edit dialog
 *    - drag-to-move   → `eventDrop` → update DB, reload
 *    - resize         → `eventResize` → update DB, reload
 *  No polling reconciler is needed (unlike the schedule-x version, which owned
 *  its in-memory event list and needed diffing); FullCalendar simply renders
 *  whatever the controlled events prop says. */
export function CalendarPage() {
  const t = useT();
  const db = useDB();
  const isDark = useIsDark();
  const uiLanguage = useSettingsStore((s) => s.uiLanguage);

  const [events, setEvents] = useState<CalendarEventRow[] | null>(null);
  const [calendars, setCalendars] = useState<CalendarCategoryRow[] | null>(null);
  const [error, setError] = useState(false);

  const fcLocale = uiLanguage === "zh" ? zhCnLocale : "en";

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setError(false);
    try {
      const [evs, cals] = await Promise.all([db.listEvents(), db.listCalendars()]);
      // FK is ON DELETE SET NULL, so a deleted category can orphan an event
      // under a null calendar_id — re-home those to "default" so they still
      // render rather than vanishing.
      const safeEvents = evs.map((e) => ({
        ...e,
        calendar_id: e.calendar_id && cals.some((c) => c.id === e.calendar_id) ? e.calendar_id : "default",
      }));
      setEvents(safeEvents);
      setCalendars(cals);
    } catch {
      setError(true);
    }
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  // Picks up events the AI Chat calendar tools create/edit/delete while this
  // page isn't the one that made the change.
  useEffect(() => {
    window.addEventListener("calendar-updated", load);
    return () => window.removeEventListener("calendar-updated", load);
  }, [load]);

  // ── controlled event source ────────────────────────────────────────────────
  // DB rows → FullCalendar EventInput[], tinted with each calendar's colour
  // (or a per-event override). Recomputed only when the DB data or theme
  // changes; the new array identity prompts FullCalendar React to re-sync
  // its internal event list. Calendars no longer have a visibility toggle
  // in the UI (the sidebar that offered one was removed), so every event
  // shows regardless of its calendar's `visible` flag — that column is now
  // vestigial rather than filtered on.
  const fcEvents = useMemo<EventInput[]>(() => {
    if (!events || !calendars) return [];
    const colorMap = new Map(calendars.map((c) => [c.id, c.color_name]));
    return events
      .map((row) => {
        // The row's `all_day` flag is authoritative — the Rust side enforces
        // no consistency between flag and string format, and the AI chat's
        // `update_event` tool can flip `allDay` on a timed event while the
        // COALESCE keeps the "YYYY-MM-DD HH:mm" strings. The length sniff
        // stays only as a legacy fallback for pre-flag rows.
        const allDay = row.all_day || isAllDayWire(row.start, row.end);
        const calendarId = row.calendar_id || "default";
        // A per-event override wins over the calendar's own color.
        const colorName = row.color_name ?? colorMap.get(calendarId) ?? "blue";
        return {
          id: row.id,
          title: row.title || "(untitled)",
          start: wireToFc(row.start, allDay),
          end: wireToFc(row.end, allDay),
          allDay,
          color: colorTokenToHex(colorName, isDark),
          textColor: colorTokenToTextColor(colorName, isDark),
          extendedProps: {
            calendarId,
            description: row.description,
            location: row.location,
          },
        } satisfies EventInput;
      });
  }, [events, calendars, isDark]);

  // ── event sidebar: collapse, search, pagination ─────────────────────────────
  // Collapsed by default only ever set by the user; search/pagination apply
  // to this list only — the grid itself always shows everything, so neither
  // hides an event you're mid-drag on or navigating toward.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const EVENTS_PAGE_SIZE = 10;

  // Toggling the sidebar changes the calendar's flex-basis width via plain
  // CSS reflow, which fires no `window resize` event — the one thing
  // FullCalendar listens for on its own. Without this it keeps rendering at
  // its old width until something else (an actual window resize) forces a
  // remeasure. `updateSize()` is FullCalendar's own public API for exactly
  // this ("I resized your container myself, go recompute"). The rAF lets
  // the DOM finish reflowing to the new width before FullCalendar measures
  // it — calling synchronously in the same tick as the state flip can read
  // the pre-toggle layout.
  const calendarApiRef = useRef<CalendarApi | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      calendarApiRef.current?.updateSize();
    });
    return () => cancelAnimationFrame(raf);
  }, [sidebarCollapsed]);

  const searchedEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q === "") return events ?? [];
    return (events ?? []).filter((e) =>
      e.title.toLowerCase().includes(q)
      || e.description.toLowerCase().includes(q)
      || e.location.toLowerCase().includes(q));
  }, [events, searchQuery]);

  // A new/narrower result set can leave `page` pointing past the end (e.g.
  // typing a query while on page 3) — clamp rather than stash a second piece
  // of state to keep in sync with it.
  const pageCount = Math.max(1, Math.ceil(searchedEvents.length / EVENTS_PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pagedEvents = searchedEvents.slice(
    clampedPage * EVENTS_PAGE_SIZE,
    clampedPage * EVENTS_PAGE_SIZE + EVENTS_PAGE_SIZE,
  );

  // ── dialog state ───────────────────────────────────────────────────────────
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventRow | null>(null);
  const [eventPrefill, setEventPrefill] = useState<Partial<EventDraft> | null>(null);

  const openCreateEventAt = useCallback((start: string, end: string, allDay: boolean) => {
    setEditingEvent(null);
    setEventPrefill({ start, end, allDay, calendarId: undefined });
    setEventDialogOpen(true);
  }, []);

  const openEditEvent = (row: CalendarEventRow) => {
    setEditingEvent(row);
    setEventDialogOpen(true);
  };

  // ── FullCalendar callbacks ──────────────────────────────────────────────────

  /** Drag-to-create (or click an empty slot): FullCalendar fires `select` with
   *  the chosen start/end/allDay. Open the create dialog pre-filled with that
   *  range so the user only has to type a title. */
  const handleSelect = useCallback((arg: DateSelectArg) => {
    const allDay = arg.allDay;
    const startWire = fcToWire(arg.start, allDay);
    const endWire = fcToWire(arg.end, allDay);
    openCreateEventAt(startWire, endWire, allDay);
  }, [openCreateEventAt]);

  /** Click an event → open the edit dialog with the full DB row. */
  const handleEventClick = useCallback((arg: EventClickArg) => {
    const row = events?.find((e) => e.id === arg.event.id);
    if (row) openEditEvent(row);
  }, [events]);

  /** Drag-to-move: persist the new start/end to the DB. `revert()` undoes the
   *  visual move if the write fails, so the calendar stays honest. */
  const handleEventDrop = useCallback(async (arg: EventDropArg) => {
    const ev = arg.event;
    const allDay = ev.allDay;
    const startWire = fcToWire(ev.start ?? "", allDay);
    const endWire = ev.end ? fcToWire(ev.end, allDay) : startWire;
    // `db.updateEvent` resolves `false` on failure (it toasts internally)
    // rather than rejecting, so the boolean is what must be checked — the
    // old `catch` was dead code and a failed write left the event visually
    // at its dropped position.
    const ok = await db.updateEvent({ id: ev.id, start: startWire, end: endWire, allDay });
    if (!ok) {
      arg.revert();
      return;
    }
    await load();
  }, [db, load]);

  /** Resize: same as drop — persist the new end, revert on failure. The resize
   *  callback arg (`EventResizeDoneArg`) has the same `event`/`revert` fields as
   *  `EventDropArg` — both extend `EventChangeArg` — so the body is identical. */
  const handleEventResize = useCallback(async (arg: EventResizeDoneArg) => {
    const ev = arg.event;
    const allDay = ev.allDay;
    const startWire = fcToWire(ev.start ?? "", allDay);
    const endWire = ev.end ? fcToWire(ev.end, allDay) : startWire;
    const ok = await db.updateEvent({ id: ev.id, start: startWire, end: endWire, allDay });
    if (!ok) {
      arg.revert();
      return;
    }
    await load();
  }, [db, load]);

  // ── dialog handlers ────────────────────────────────────────────────────────
  // Returns false on a failed write (the hooks toast internally but resolve
  // false rather than rejecting) so the dialog stays open with the draft.
  const handleSaveEvent = async (draft: EventDraft): Promise<boolean> => {
    let ok: boolean;
    if (draft.id) {
      ok = await db.updateEvent({
        id: draft.id,
        title: draft.title,
        start: draft.start,
        end: draft.end,
        allDay: draft.allDay,
        calendarId: draft.calendarId,
        description: draft.description,
        location: draft.location,
        // Always sent (not sparse) so an explicit '' can clear a prior
        // override back to inheriting the calendar's color — see the Rust
        // command's own comment on why this field needs that distinction.
        colorName: draft.colorName,
      });
    } else {
      ok = (await db.createEvent({
        title: draft.title,
        start: draft.start,
        end: draft.end,
        allDay: draft.allDay,
        calendarId: draft.calendarId,
        description: draft.description,
        location: draft.location,
        colorName: draft.colorName,
      })) !== null;
    }
    if (!ok) return false;
    await load();
    return true;
  };

  const handleDeleteEvent = async (id: string): Promise<boolean> => {
    const ok = await db.deleteEvent(id);
    if (!ok) return false;
    await load();
    return true;
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (events === null || calendars === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        {t("calendar.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{t("calendar.loadError")}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>{t("calendar.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Body: calendar + event sidebar */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* FullCalendar. `flex-1 min-h-0` gives it a definite height; the `.fc`
          * height:100% rule in index.css makes FullCalendar fill it. */}
        <div className="fc-calendar min-h-0 flex-1 p-2 mr-3 sm:p-4">
          <FullCalendar
            ref={(instance) => { calendarApiRef.current = instance?.getApi() ?? null; }}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale={fcLocale}
            firstDay={1}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            height="100%"
            selectable
            editable
            dayMaxEvents
            slotMinTime="00:00:00"
            slotMaxTime="23:00:00"
            nowIndicator
            events={fcEvents}
            select={handleSelect}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
          />
        </div>

        {/* Event sidebar: quick edit access on mobile (where drag is fiddly)
          * and a fallback view, with a search box over title/description/
          * location and pagination once there are more than a page's worth.
          * Filters/pages this list only — the grid keeps showing every event
          * regardless of the query or page. Collapsible: the calendar is the
          * primary surface, so this panel gives its width back on request.
          * The toggle sits outside the panel, straddling its top-left border,
          * rather than inline with the panel's own content — a handle on the
          * edge, not a button that scrolls away with the list. */}
        <div className="relative flex shrink-0">
          {sidebarCollapsed ? null : (
            <aside className="flex w-full flex-col gap-2 border-t border-border/80 p-3 lg:w-64 lg:border-l lg:border-t-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => { setSearchQuery(event.target.value); setPage(0); }}
                  placeholder={t("calendar.searchPlaceholder")}
                  aria-label={t("calendar.searchAriaLabel")}
                  className="h-8 w-full rounded-lg border border-border bg-card pl-7 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary/40"
                />
              </div>
              <div>
                <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("calendar.events")} ({searchedEvents.length})
                </p>
                {searchedEvents.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {events.length === 0 ? t("calendar.noEvents") : t("calendar.searchNoResults")}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {pagedEvents.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => openEditEvent(e)}
                      className="min-w-0 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                      title={e.title}
                    >
                      <span className="block truncate font-medium">{e.title || "(untitled)"}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{e.start}</span>
                    </button>
                  ))}
                </div>
                {pageCount > 1 && (
                  <div className="mt-2 flex items-center justify-between gap-2 px-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={clampedPage === 0}
                      aria-label={t("calendar.previousPage")}
                      className="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-[10px] text-muted-foreground">
                      {t("calendar.pageOf", { page: String(clampedPage + 1), total: String(pageCount) })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={clampedPage >= pageCount - 1}
                      aria-label={t("calendar.nextPage")}
                      className="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </aside>
          )}
          {/* A small tab/handle flush against the panel's left edge, not a
            * free-floating circle — same shape language as a drawer pull
            * tab: rounded only on the outward side, attached to the border
            * it controls rather than hovering apart from it. */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? t("calendar.expandSidebar") : t("calendar.collapseSidebar")}
            aria-label={sidebarCollapsed ? t("calendar.expandSidebar") : t("calendar.collapseSidebar")}
            className="absolute -left-5 top-16 z-10 hidden h-9 w-5 items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground lg:flex"
          >
            {sidebarCollapsed ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <CalendarEventDialog
        open={eventDialogOpen}
        onClose={() => setEventDialogOpen(false)}
        event={editingEvent}
        calendars={calendars}
        prefill={eventPrefill}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
      />
    </div>
  );
}

export default CalendarPage;

// ── helpers ──────────────────────────────────────────────────────────────────

/** An event is all-day when its wire times are date-only (10 chars, no time). */
function isAllDayWire(start: string, end: string): boolean {
  return start.length === 10 && end.length === 10;
}
