import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Contract tests for the in-app reminder alert surface. The backend window
 *  math is covered in Rust (`ntfy::tests`); these pin the renderer's half:
 *  freshness, once-per-session dedupe, and the per-host OS-notification
 *  plumbing (desktop IPC / browser Notification permission flow). */

const { invoke, toast, isDesktopHost } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  isDesktopHost: { value: true },
}));

vi.mock("@/ipc/backend", () => ({ invoke }));
vi.mock("@/ipc/events", () => ({ subscribeAll: vi.fn(() => () => {}) }));
vi.mock("@/platform", () => ({ get isDesktopHost() { return isDesktopHost.value; } }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/store/navStore", () => ({
  useNavStore: { getState: () => ({ navigate: vi.fn() }) },
}));
vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const dict: Record<string, string> = {
      "calendar.reminderToday": "Today",
      "calendar.reminderInMinutes": "In {minutes} minutes",
      "calendar.reminderStarting": "Starting now",
      "calendar.reminderEnableTitle": "Enable system notifications?",
      "calendar.reminderEnableBody": "body",
      "calendar.reminderEnableAction": "Enable",
    };
    let str = dict[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, () => String(v));
    }
    return str;
  },
}));

import { useReminderAlerts } from "./useReminderAlerts";
import { POLL_MS } from "./useReminderAlerts";

/** A due_at wire string `minutesAgo` in the past, in the calendar DB's
 *  `YYYY-MM-DD HH:mm` local shape. */
function wireDue(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reminder(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "e1",
    title: "Team meeting",
    all_day: false,
    starts_in_minutes: 30,
    due_at: wireDue(0),
    ...over,
  };
}

/** jsdom's visibilityState is a prototype getter; shadow it per test. */
function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset().mockResolvedValue([]);
  toast.mockReset();
  isDesktopHost.value = true;
  setVisibility("hidden");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
});

/** Flush the mount-time poll's microtasks. */
async function flush() {
  await act(async () => {});
}

describe("useReminderAlerts", () => {
  it("alerts a fresh due reminder once — toast plus the desktop OS notification — and stays quiet on later polls", async () => {
    invoke.mockResolvedValue([reminder()]);
    renderHook(() => useReminderAlerts(true));
    await flush();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Team meeting", expect.objectContaining({ description: "In 30 minutes" }));
    expect(invoke).toHaveBeenCalledWith("window_show_notification", {
      title: "Team meeting",
      body: "In 30 minutes",
      openEvent: "calendar://open",
    });

    // The same event still reports due on the next poll (its window stays
    // open until the start) — the session dedupe must not re-alert.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(toast).toHaveBeenCalledTimes(1);
    const osCalls = invoke.mock.calls.filter(([c]) => c === "window_show_notification");
    expect(osCalls).toHaveLength(1);
  });

  it("renders the all-day and starting-now phrases", async () => {
    invoke.mockResolvedValue([
      reminder({ id: "a", title: "Picnic", all_day: true }),
      reminder({ id: "b", title: "Standup", starts_in_minutes: 0 }),
    ]);
    renderHook(() => useReminderAlerts(true));
    await flush();

    const descriptions = toast.mock.calls.map(([, opts]) => (opts as { description: string }).description);
    expect(descriptions).toEqual(["Today", "Starting now"]);
  });

  it("skips reminders that went stale while the app was closed", async () => {
    invoke.mockResolvedValue([reminder({ due_at: wireDue(120), starts_in_minutes: -110 })]);
    renderHook(() => useReminderAlerts(true));
    await flush();

    expect(toast).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("window_show_notification", expect.anything());
  });

  it("skips a malformed due_at instead of alerting", async () => {
    invoke.mockResolvedValue([reminder({ due_at: "garbage" })]);
    renderHook(() => useReminderAlerts(true));
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it("desktop: raises no OS notification while the app is visibly in front — the toast is the alert", async () => {
    setVisibility("visible");
    invoke.mockResolvedValue([reminder()]);
    renderHook(() => useReminderAlerts(true));
    await flush();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("window_show_notification", expect.anything());
  });

  describe("web host", () => {
    let made: Array<{ title: string; options?: NotificationOptions | undefined }>;

    beforeEach(() => {
      isDesktopHost.value = false;
      made = [];
      class FakeNotification {
        static permission = "granted";
        onclick: (() => void) | null = null;
        constructor(public title: string, public options?: NotificationOptions) {
          made.push({ title, options });
        }
        close(): void {}
      }
      vi.stubGlobal("Notification", FakeNotification);
    });

    function fakePermission(value: string) {
      (Notification as unknown as { permission: string }).permission = value;
    }

    it("uses the browser Notification when permission is granted", async () => {
      fakePermission("granted");
      invoke.mockResolvedValue([reminder()]);
      renderHook(() => useReminderAlerts(true));
      await flush();

      expect(made).toHaveLength(1);
      expect(made[0].title).toBe("Team meeting");
      expect((made[0].options as { body: string }).body).toBe("In 30 minutes");
    });

    it("offers the enable action on the first reminder when permission is untouched, once per session", async () => {
      fakePermission("default");
      invoke.mockResolvedValue([reminder()]);
      renderHook(() => useReminderAlerts(true));
      await flush();

      const enableToasts = toast.mock.calls.filter(([, opts]) =>
        Boolean((opts as { action?: unknown }).action));
      expect(enableToasts).toHaveLength(1);
      // The alert itself still fired.
      expect(toast).toHaveBeenCalledWith("Team meeting", expect.anything());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS);
      });
      const after = toast.mock.calls.filter(([, opts]) => Boolean((opts as { action?: unknown }).action));
      expect(after).toHaveLength(1);
    });

    it("degrades to toast-only when permission is denied", async () => {
      fakePermission("denied");
      invoke.mockResolvedValue([reminder()]);
      renderHook(() => useReminderAlerts(true));
      await flush();

      expect(toast).toHaveBeenCalledTimes(1);
      expect(made).toHaveLength(0);
    });
  });
});
