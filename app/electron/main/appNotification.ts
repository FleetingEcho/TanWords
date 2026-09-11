/** System notifications for renderer-originated alerts (calendar reminders).
 *
 *  The renderer owns the alerting loop — it polls the sidecar for due
 *  reminders and shows an in-app toast regardless — but only the main
 *  process can raise a real OS notification (Electron's renderer-side HTML5
 *  Notification is flaky across platforms, and the main process is also what
 *  can focus the window when the notification is clicked).
 *
 *  Mirrors `notifyDshTaskFinished` in index.ts on two rules: skip entirely
 *  while the window is focused (the user is looking at the app, the toast is
 *  the alert — a system notification would just be noise on top of it), and
 *  track outstanding notifications in a set so the launcher badge clears.
 *  Linux notification daemons (KDE/GNOME/dash-to-dock) badge the app icon by
 *  unread-notification count, and those notifications OUTLIVE the process
 *  that spawned them — so they are closed on window focus and quit, not just
 *  on click. */
import { Notification } from "electron";
import { restoreAndFocusWindow } from "./windowVisibility";
import type { IpcDeps } from "./ipc";

const outstanding = new Set<Notification>();

/** Closes every outstanding app notification and drops the references, so
 *  the launcher badge clears. Safe to call when there are none. */
export function closeAllAppNotifications(): void {
  for (const n of outstanding) {
    try { n.close(); } catch { /* already gone */ }
  }
  outstanding.clear();
}

export interface AppNotificationOptions {
  title: string;
  body: string;
  /** Broadcast to the renderer when the notification is clicked, after the
   *  window is back in front — e.g. `calendar://open` makes the reminder
   *  land on the calendar page (see useReminderAlerts). */
  openEvent?: string;
}

/** Raises one OS notification for a due reminder. A no-op when the OS has no
 *  notification center or the window already has focus. */
export function showAppNotification(deps: IpcDeps, options: AppNotificationOptions): void {
  if (!Notification.isSupported()) return;
  const win = deps.getMainWindow();
  if (win && !win.isDestroyed() && win.isFocused()) return;

  const notification = new Notification({ title: options.title, body: options.body, silent: false });
  outstanding.add(notification);
  notification.on("close", () => { outstanding.delete(notification); });
  notification.on("click", () => {
    const w = deps.getMainWindow();
    if (w && !w.isDestroyed()) restoreAndFocusWindow(w);
    if (options.openEvent) deps.broadcastEvent(options.openEvent, null);
    notification.close(); // the user has acknowledged it — drop the badge
  });
  notification.show();
}
