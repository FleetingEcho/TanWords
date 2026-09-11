/** In-app calendar reminder alerts.
 *
 *  The ntfy push (Settings → Notifications) reaches the *phone* and is sent
 *  by the always-on web server — but nothing inside the app itself ever
 *  showed a reminder. This hook is that surface, shared by both hosts: it
 *  polls the sidecar/web backend for reminders whose in-app window is open
 *  (`ntfy_due_in_app_reminders`, the same window math as the push) and, for
 *  each, shows a toast plus a real system notification:
 *
 *    - desktop — `window_show_notification` IPC; Electron main raises the
 *      OS notification (skipped while the window is focused) and focuses the
 *      window on click;
 *    - web — the browser Notification API. Permission is never requested
 *      without a gesture (browsers reject timer-driven prompts), so the
 *      first reminder offers an "Enable" action button instead; a denied
 *      permission degrades to toast-only, silently.
 *
 *  The backend deliberately ignores `reminder_sent_at` (the web server may
 *  have claimed the phone push, and in-app delivery needs no ntfy config at
 *  all), so freshness and dedupe live here: a reminder is alerted only while
 *  it became due within FRESH_WINDOW_MS, and each event alerts once per app
 *  run (an event re-alerts after a restart only while still in its window).
 *  Mount once, gated on the auth state. */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { invoke } from "@/ipc/backend";
import { subscribeAll } from "@/ipc/events";
import { useNavStore } from "@/store/navStore";
import { isDesktopHost } from "@/platform";
import { useT } from "./useT";

interface InAppReminder {
  id: string;
  title: string;
  all_day: boolean;
  starts_in_minutes: number;
  due_at: string;
}

/** Aligned with the web server's push tick (30 s) — an alert lands within
 *  the same minute the reminder became due, in both hosts. */
export const POLL_MS = 30_000;

/** A reminder that became due longer ago than this is stale: it plays only
 *  when the app launch (or the poll that first sees it) lands inside its
 *  window. Without this, reopening the app hours later would replay a whole
 *  day of old "Today: …" toasts. */
const FRESH_WINDOW_MS = 5 * 60_000;

/** `calendar://open` — broadcast by Electron main when a reminder
 *  notification is clicked; the web notification click navigates directly. */
const OPEN_EVENT = "calendar://open";

/** Wire `YYYY-MM-DD HH:mm` (local time, same shape as the calendar DB) →
 *  epoch ms. NaN when unparseable. */
function parseDueAt(wire: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(wire);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

export function useReminderAlerts(enabled: boolean) {
  const t = useT();
  // The poll interval outlives the render that created it; keep the latest
  // translator reachable from inside it without re-arming the effect on a
  // language change.
  const tRef = useRef(t);
  tRef.current = t;
  const permissionToastShown = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const timePhrase = (r: InAppReminder): string => {
      if (r.all_day) return tRef.current("calendar.reminderToday");
      if (r.starts_in_minutes > 0) {
        return tRef.current("calendar.reminderInMinutes", { minutes: r.starts_in_minutes });
      }
      return tRef.current("calendar.reminderStarting");
    };

    /** Real OS notification for one alert. Desktop routes through main; web
     *  uses the browser API with a gesture-safe permission flow. Skipped
     *  while the app is visibly in front — the toast is the alert (same rule
     *  as Electron main applies on its side). */
    const osNotify = (r: InAppReminder, title: string, body: string): void => {
      if (document.visibilityState === "visible") return;
      if (isDesktopHost) {
        void invoke("window_show_notification", { title, body, openEvent: OPEN_EVENT }).catch(() => {});
        return;
      }
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        const n = new Notification(title, { body, icon: "/icon-512.png", tag: `tanwords-reminder-${r.id}` });
        n.onclick = () => {
          window.focus();
          useNavStore.getState().navigate("calendar");
          n.close();
        };
        return;
      }
      // "default": asking from a timer is rejected by browsers, so offer the
      // grant as a toast action the user can click (a real gesture). Once
      // per session — a reminder stream must not nag.
      if (Notification.permission === "default" && !permissionToastShown.current) {
        permissionToastShown.current = true;
        toast(tRef.current("calendar.reminderEnableTitle"), {
          description: tRef.current("calendar.reminderEnableBody"),
          action: {
            label: tRef.current("calendar.reminderEnableAction"),
            onClick: () => void Notification.requestPermission(),
          },
          duration: 15_000,
        });
      }
      // "denied": toast-only, silently.
    };

    const alert = (r: InAppReminder): void => {
      const body = timePhrase(r);
      // No click-to-navigate on the toast: sonner routes dismiss (the ✕
      // button too) through onDismiss, so a click handler would drag the
      // user to the calendar on "acknowledge" as well. The OS notification
      // click is the navigate affordance.
      toast(r.title, { description: body, duration: 10_000 });
      osNotify(r, r.title, body);
    };

    /** Every event already alerted this app run — the backend window stays
     *  open long after the alert (up to the event's start), so this is what
     *  keeps a reminder a one-time alert per session. */
    const alerted = new Set<string>();

    const poll = async (): Promise<void> => {
      let rows: InAppReminder[];
      try {
        rows = await invoke<InAppReminder[]>("ntfy_due_in_app_reminders");
      } catch {
        return; // backend not up yet / logged out — retry on the next tick
      }
      const now = Date.now();
      for (const r of rows) {
        if (cancelled) return;
        if (alerted.has(r.id)) continue;
        const due = parseDueAt(r.due_at);
        if (!Number.isFinite(due) || now - due > FRESH_WINDOW_MS) continue;
        alerted.add(r.id);
        alert(r);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const unsubscribe = subscribeAll({
      [OPEN_EVENT]: () => useNavStore.getState().navigate("calendar"),
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [enabled]);
}
