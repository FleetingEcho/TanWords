import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/backend", () => ({ invoke: invokeMock }));

import { executeTool } from "./tools";

function call(name: string, input: Record<string, unknown> = {}) {
  return executeTool({ id: "t1", name, input });
}

describe("vocabulary AI tools", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns the saved word count", async () => {
    invokeMock.mockResolvedValue(42);

    const result = await call("get_vocabulary_stats");

    expect(invokeMock).toHaveBeenCalledWith("db_get_word_count");
    expect(result.content).toContain("42");
    expect(result.content).toContain("words");
  });

  it("lists a page of words with meaning, level, and SRS metadata", async () => {
    invokeMock.mockResolvedValue([
      { word: "serendipity", zh: "意外发现", level: "C1", srs_level: 3 },
      { word: "hedge", zh: "对冲", level: "B2", srs_level: 0 },
    ]);

    const result = await call("list_vocabulary", { limit: 1, sortBy: "alpha" });

    expect(invokeMock).toHaveBeenCalledWith(
      "db_get_words",
      expect.objectContaining({ search: null, levelFilter: null, sortBy: "alpha" })
    );
    expect(result.content).toContain("Vocabulary has 2 words");
    expect(result.content).toContain("serendipity");
    expect(result.content).toContain("意外发现");
  });

  it("reports an empty vocabulary", async () => {
    invokeMock.mockResolvedValue([]);

    const result = await call("list_vocabulary");

    expect(result.content).toBe("No vocabulary words found.");
  });

  it("saves generated sentences to the sentence library", async () => {
    invokeMock
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });

    const result = await call("save_sentences", {
      sentences: [
        { sentence: "It was not until later that the pattern became clear.", zh: "直到后来这个规律才清晰起来." },
        { sentence: "The plan hinges on timing.", zh: "这个计划取决于时机." },
      ],
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "db_save_sentence", expect.objectContaining({
      sentence: "It was not until later that the pattern became clear.",
      source: "chat",
    }));
    expect(result.content).toContain("Saved 1 sentence");
    expect(result.content).toContain("skipped 1");
  });
});

describe("calendar AI tools", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it("creates a timed event with the default 30-minute reminder", async () => {
    invokeMock.mockResolvedValue("evt-1");

    const result = await call("create_event", {
      title: "Dentist",
      start: "2026-09-10 15:00",
      end: "2026-09-10 16:00",
    });

    expect(invokeMock).toHaveBeenCalledWith("db_create_calendar_event", expect.objectContaining({
      title: "Dentist",
      allDay: false,
      reminderMinutes: 30,
    }));
    expect(result.content).toContain("reminder 30 min before");
  });

  it("creates an all-day event defaulting to the morning reminder", async () => {
    invokeMock.mockResolvedValue("evt-2");

    await call("create_event", {
      title: "Trip",
      start: "2026-09-12",
      end: "2026-09-13",
      all_day: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("db_create_calendar_event", expect.objectContaining({
      allDay: true,
      reminderMinutes: 0,
    }));
  });

  it("honours an explicit reminder opt-out (null)", async () => {
    invokeMock.mockResolvedValue("evt-3");

    const result = await call("create_event", {
      title: "Focus block",
      start: "2026-09-10 09:00",
      end: "2026-09-10 10:00",
      reminder_minutes: null,
    });

    expect(invokeMock).toHaveBeenCalledWith("db_create_calendar_event", expect.objectContaining({
      reminderMinutes: null,
    }));
    expect(result.content).toContain("no reminder");
  });

  it("keeps the reminder untouched when update_event omits reminder_minutes", async () => {
    await call("update_event", { id: "evt-1", title: "Renamed" });

    const [, payload] = invokeMock.mock.calls[0];
    expect(payload).not.toHaveProperty("reminderMinutes");
  });

  it("passes a reminder change through update_event", async () => {
    await call("update_event", { id: "evt-1", reminder_minutes: 60 });

    expect(invokeMock).toHaveBeenCalledWith("db_update_calendar_event", expect.objectContaining({
      id: "evt-1",
      reminderMinutes: 60,
    }));
  });

  it("turns the reminder off with an explicit null update", async () => {
    await call("update_event", { id: "evt-1", reminder_minutes: null });

    expect(invokeMock).toHaveBeenCalledWith("db_update_calendar_event", expect.objectContaining({
      reminderMinutes: null,
    }));
  });

  it("lists events with their reminder state", async () => {
    invokeMock.mockResolvedValue([
      { id: "a", title: "Timed", start: "2026-09-10 15:00", end: "2026-09-10 16:00", all_day: false, description: "", location: "", reminder_minutes: 30 },
      { id: "b", title: "AllDay", start: "2026-09-11", end: "2026-09-12", all_day: true, description: "", location: "", reminder_minutes: 0 },
      { id: "c", title: "Quiet", start: "2026-09-12 09:00", end: "2026-09-12 10:00", all_day: false, description: "", location: "", reminder_minutes: null },
    ]);

    const result = await call("list_events", {});

    expect(result.content).toContain("[reminder 30m before]");
    expect(result.content).toContain("[morning reminder]");
    expect(result.content).toContain("[no reminder]");
  });
});
