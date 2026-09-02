/** Reminder option list and conversions for the event dialog.
 *
 * The DB stores one `reminder_minutes` column for both event shapes: timed
 * events keep an actual lead time (5/15/30/60); all-day events keep `0`, which
 * the Rust scheduler reads as "remind at the configured morning time"
 * (settings → ntfy → all-day time, default 09:00). `null` means off for
 * both. These helpers keep the dialog's `<select>` values and the
 * all-day-toggle conversion in one testable place. */

/** The lead a *new* timed event gets by default (user decision: 30). */
export const DEFAULT_TIMED_REMINDER = 30;

/** The timed-event options, display order. */
export const TIMED_REMINDER_OPTIONS: readonly number[] = [5, 15, 30, 60];

/** A stored value → the `<select>`'s string value. */
export function reminderMinutesToOption(minutes: number | null): string {
  return minutes === null ? "off" : String(minutes);
}

/** The `<select>`'s string value → what gets stored. Unknown values (a
 * stored lead that predates the option list) round-trip as themselves. */
export function reminderOptionToMinutes(option: string): number | null {
  if (option === "off") return null;
  const n = Number(option);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** When the all-day toggle flips, the stored reminder switches shape: a lead
 * time is meaningless for all-day (it becomes "morning", stored 0), and 0
 * is meaningless for timed (it becomes the default lead). Off stays off —
 * toggling the event's length never silently enables a reminder. */
export function reminderForAllDay(minutes: number | null, allDay: boolean): number | null {
  if (minutes === null) return null;
  return allDay ? 0 : DEFAULT_TIMED_REMINDER;
}
