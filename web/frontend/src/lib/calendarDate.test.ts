import { describe, expect, it } from "vitest";
import { formatCalendarDate, parseCalendarDate } from "./calendarDate";

describe("calendar dates", () => {
  it("parses a date-only string as local midnight, not UTC", () => {
    const date = parseCalendarDate("2026-07-31");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(31);
    expect(date.getHours()).toBe(0);
  });

  it("round-trips without drifting a day", () => {
    // The bug this guards: `new Date("2026-07-31")` is UTC midnight, which
    // formats back as the 30th anywhere west of UTC.
    for (const iso of ["2026-01-01", "2026-07-31", "2026-12-31", "2024-02-29"]) {
      expect(formatCalendarDate(parseCalendarDate(iso))).toBe(iso);
    }
  });

  it("zero-pads month and day", () => {
    expect(formatCalendarDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("formats a Date by its local day, ignoring the time of day", () => {
    expect(formatCalendarDate(new Date(2026, 6, 31, 23, 59, 59))).toBe("2026-07-31");
  });
});
