import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMED_REMINDER,
  reminderForAllDay,
  reminderMinutesToOption,
  reminderOptionToMinutes,
} from "./reminderOptions";

describe("reminderOptions", () => {
  it("maps null (off) both ways", () => {
    expect(reminderMinutesToOption(null)).toBe("off");
    expect(reminderOptionToMinutes("off")).toBeNull();
  });

  it("maps lead times to their numeric option", () => {
    expect(reminderMinutesToOption(30)).toBe("30");
    expect(reminderOptionToMinutes("15")).toBe(15);
  });

  it("round-trips an unknown stored lead without clamping it away", () => {
    // An event saved before the option list existed (or via AI chat tools)
    // can carry e.g. 45 — it must survive a dialog open/close untouched.
    expect(reminderOptionToMinutes(reminderMinutesToOption(45))).toBe(45);
  });

  it("rejects non-numeric junk as off", () => {
    expect(reminderOptionToMinutes("banana")).toBeNull();
    expect(reminderOptionToMinutes("-5")).toBeNull();
  });

  it("converts shape when the all-day toggle flips", () => {
    // Timed → all-day: the lead collapses to the morning sentinel 0.
    expect(reminderForAllDay(30, true)).toBe(0);
    // All-day → timed: the sentinel becomes the default lead.
    expect(reminderForAllDay(0, false)).toBe(DEFAULT_TIMED_REMINDER);
    // Off never turns itself on by toggling.
    expect(reminderForAllDay(null, true)).toBeNull();
    expect(reminderForAllDay(null, false)).toBeNull();
  });
});
