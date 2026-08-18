/** Calendar events and colour-category "calendars" — composed by useDB.ts
 *  alongside the other domain sub-hooks (see useDB.ts). Mirrors the Rust
 *  commands in app/core/src/db/calendar.rs: times are Schedule-X wire strings
 *  (`YYYY-MM-DD` all-day, `YYYY-MM-DD HH:mm` timed), ids are uuid strings, and
 *  partial updates omit unchanged fields so the backend's COALESCE keeps them.
 *
 *  The event payload here is the raw DB row; the Calendar page maps it to
 *  Schedule-X's `CalendarEvent` shape (which uses `start`/`end` as the same
 *  wire strings and `id` as a string|number). */
import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";

export interface CalendarCategoryRow {
  id: string;
  name: string;
  color_name: string;
  visible: boolean;
  sort_order: number;
}

export interface CalendarEventRow {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  description: string;
  location: string;
  created_at: string;
  updated_at: string;
  /** A per-event colour override token, or `null` to inherit the parent
   *  calendar's colour (see calendarColors.ts's CALENDAR_COLOR_TOKENS). */
  color_name: string | null;
}

/** The subset of fields the create command accepts; `id` is optional so the
 *  backend can mint a uuid when the frontend doesn't supply one. */
export interface CalendarEventInput {
  id?: string;
  calendarId?: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  /** '' (or omitted) inherits the calendar's colour. */
  colorName?: string;
}

/** Partial update — every field except `id` is optional so drag-to-move sends
 *  only start/end and the edit modal sends only the fields it changed.
 *  `colorName` is special: omitting it leaves the event's colour untouched,
 *  but an explicit `''` clears an existing override back to "inherit" (see
 *  the Rust command's own comment on why this one field needs that
 *  three-way distinction). */
export interface CalendarEventUpdate {
  id: string;
  calendarId?: string;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  colorName?: string;
}

export interface CalendarCategoryInput {
  id?: string;
  name: string;
  colorName?: string;
  visible?: boolean;
  sortOrder?: number;
}

export interface CalendarCategoryUpdate {
  id: string;
  name?: string;
  colorName?: string;
  visible?: boolean;
  sortOrder?: number;
}

export function useDBCalendar() {
  // ── events ──────────────────────────────────────────────────────────────

  const listEvents = useCallback(async (): Promise<CalendarEventRow[]> => {
    try {
      return await invoke<CalendarEventRow[]>("db_list_calendar_events");
    } catch (e) {
      logError("listCalendarEvents", e);
      return [];
    }
  }, []);

  const createEvent = useCallback(async (input: CalendarEventInput): Promise<string | null> => {
    try {
      return await invoke<string>("db_create_calendar_event", {
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: input.allDay ?? false,
        calendarId: input.calendarId,
        description: input.description,
        location: input.location,
        colorName: input.colorName,
        id: input.id,
      });
    } catch (e) {
      reportWriteError("createCalendarEvent", e, "Failed to create event");
      return null;
    }
  }, []);

  /** Partial update. Returns true on success so the caller can decide whether
   *  to refetch or optimistically patch its local copy. */
  const updateEvent = useCallback(async (update: CalendarEventUpdate): Promise<boolean> => {
    try {
      await invoke("db_update_calendar_event", {
        id: update.id,
        calendarId: update.calendarId,
        title: update.title,
        start: update.start,
        end: update.end,
        allDay: update.allDay,
        description: update.description,
        location: update.location,
        colorName: update.colorName,
      });
      return true;
    } catch (e) {
      reportWriteError("updateCalendarEvent", e, "Failed to update event");
      return false;
    }
  }, []);

  const deleteEvent = useCallback(async (eventId: string): Promise<boolean> => {
    try {
      await invoke("db_delete_calendar_event", { eventId });
      return true;
    } catch (e) {
      reportWriteError("deleteCalendarEvent", e, "Failed to delete event");
      return false;
    }
  }, []);

  // ── calendars (colour categories) ───────────────────────────────────────

  const listCalendars = useCallback(async (): Promise<CalendarCategoryRow[]> => {
    try {
      return await invoke<CalendarCategoryRow[]>("db_list_calendar_calendars");
    } catch (e) {
      logError("listCalendarCalendars", e);
      return [];
    }
  }, []);

  const createCalendar = useCallback(async (input: CalendarCategoryInput): Promise<string | null> => {
    try {
      return await invoke<string>("db_create_calendar_calendar", {
        name: input.name,
        colorName: input.colorName,
        visible: input.visible,
        sortOrder: input.sortOrder,
        id: input.id,
      });
    } catch (e) {
      reportWriteError("createCalendarCalendar", e, "Failed to create calendar");
      return null;
    }
  }, []);

  const updateCalendar = useCallback(async (update: CalendarCategoryUpdate): Promise<boolean> => {
    try {
      await invoke("db_update_calendar_calendar", {
        id: update.id,
        name: update.name,
        colorName: update.colorName,
        visible: update.visible,
        sortOrder: update.sortOrder,
      });
      return true;
    } catch (e) {
      reportWriteError("updateCalendarCalendar", e, "Failed to update calendar");
      return false;
    }
  }, []);

  const deleteCalendar = useCallback(async (calendarId: string): Promise<boolean> => {
    try {
      await invoke("db_delete_calendar_calendar", { calendarId });
      return true;
    } catch (e) {
      reportWriteError("deleteCalendarCalendar", e, "Failed to delete calendar");
      return false;
    }
  }, []);

  return useMemo(
    () => ({
      listEvents,
      createEvent,
      updateEvent,
      deleteEvent,
      listCalendars,
      createCalendar,
      updateCalendar,
      deleteCalendar,
    }),
    [listEvents, createEvent, updateEvent, deleteEvent, listCalendars, createCalendar, updateCalendar, deleteCalendar],
  );
}
