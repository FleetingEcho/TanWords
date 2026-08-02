/** "YYYY-MM-DD" calendar dates, the form the date-range filters store and
 *  exchange. These are plain calendar days with no time and no zone — "the
 *  31st" means the same day to the user regardless of where they are.
 *
 *  Both halves have to agree on interpreting that day in LOCAL time, which is
 *  why neither is a one-liner over the `Date` constructor: `new Date("2026-07-31")`
 *  parses the date-only form as UTC midnight, so everyone west of UTC reads it
 *  back as the 30th. Building from the numeric parts pins it to local midnight
 *  instead, matching how the day was picked in the calendar. */

/** "2026-07-31" -> that day at local midnight. */
export function parseCalendarDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A Date -> the "YYYY-MM-DD" of its local calendar day. */
export function formatCalendarDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
