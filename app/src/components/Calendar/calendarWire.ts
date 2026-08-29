/** Conversions between the DB wire format and the values FullCalendar and HTML
 *  inputs use.
 *
 *  The DB stores times two ways (see app/core/src/db/calendar.rs):
 *    - `YYYY-MM-DD`       for all-day events
 *    - `YYYY-MM-DD HH:mm` for timed events (space separator, local time)
 *  FullCalendar v6 accepts ISO strings for event start/end:
 *    - all-day: `YYYY-MM-DD`           (date-only — exclusive-end convention)
 *    - timed:   `YYYY-MM-DDTHH:mm:ss` (T separator, no timezone = local)
 *  FullCalendar's interaction callbacks (`select`, `eventDrop`, `eventResize`)
 *  hand back `Date` objects in local time.
 *  `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` (a `T` separator),
 *  and `<input type="date">` wants `YYYY-MM-DD`. These helpers bridge all three
 *  without pulling in a date library. */

// ── DB wire ↔ FullCalendar ──────────────────────────────────────────────────

/** DB wire string → FullCalendar ISO string for `event.start` / `event.end`.
 *  - `YYYY-MM-DD` (all-day) → `YYYY-MM-DD`            (FullCalendar date-only)
 *  - `YYYY-MM-DD HH:mm`     → `YYYY-MM-DDTHH:mm:00`   (ISO with T, local time)
 *  Empty in → empty out. */
export function wireToFc(wire: string, allDay: boolean): string {
  if (!wire) return "";
  if (allDay || wire.length === 10) return wire; // date-only stays as-is
  // `YYYY-MM-DD HH:mm` → `YYYY-MM-DDTHH:mm:00`
  return `${wire.slice(0, 10)}T${wire.slice(11, 16)}:00`;
}

/** FullCalendar start/end → DB wire string. Accepts both Date objects (from
 *  interaction callbacks) and ISO strings (from event objects).
 *  - all-day: `YYYY-MM-DD`              (date portion only)
 *  - timed:   `YYYY-MM-DD HH:mm`        (date + HH:mm, space separator)
 *  Local time is used throughout — Date objects' `getHours/getMinutes` are
 *  local, and ISO strings without a timezone offset are parsed as local. */
export function fcToWire(value: Date | string, allDay: boolean): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (allDay || value.length === 10) return value.slice(0, 10);
    // ISO `YYYY-MM-DDTHH:mm:ss…` → `YYYY-MM-DD HH:mm`
    return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
  }
  // Date object → local-time wire string
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = value.getFullYear();
  const m = pad(value.getMonth() + 1);
  const d = pad(value.getDate());
  if (allDay) return `${y}-${m}-${d}`;
  return `${y}-${m}-${d} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

// ── DB wire ↔ HTML inputs ───────────────────────────────────────────────────

/** DB wire string → datetime-local input value (`YYYY-MM-DDTHH:mm`),
 *  or date input value (`YYYY-MM-DD`) when all-day. Empty in → empty out. */
export function wireToInputValue(wire: string, allDay: boolean): string {
  if (!wire) return "";
  // A `<input type="date">` sanitizes anything but YYYY-MM-DD to empty — so
  // slice rather than trusting flag and format to agree (they can diverge;
  // see CalendarPage's all-day handling).
  if (allDay) return wire.slice(0, 10);
  // YYYY-MM-DD HH:mm → YYYY-MM-DDTHH:mm
  return wire.length === 16 ? `${wire.slice(0, 10)}T${wire.slice(11)}` : wire.slice(0, 10);
}

/** datetime-local / date input value → DB wire string. A date input yields
 *  `YYYY-MM-DD`; a datetime-local input (`YYYY-MM-DDTHH:mm`) yields
 *  `YYYY-MM-DD HH:mm`. */
export function inputValueToWire(input: string, allDay: boolean): string {
  if (!input) return "";
  if (allDay) return input.slice(0, 10);
  // `YYYY-MM-DDTHH:mm` → `YYYY-MM-DD HH:mm`
  return input.length >= 16 ? `${input.slice(0, 10)} ${input.slice(11, 16)}` : input.slice(0, 10);
}

// ── date arithmetic on DB wire strings ──────────────────────────────────────

/** Today's date as `YYYY-MM-DD`, for the default start of a new event. */
export function todayWire(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` + add `days` → `YYYY-MM-DD`. Used for a new all-day event's
 *  default end (FullCalendar uses exclusive ends, so an all-day event on Jan
 *  31 has end = Feb 1). */
export function addDaysWire(wire: string, days: number): string {
  const [y, m, d] = wire.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
