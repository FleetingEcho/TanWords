import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Notification, session, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAppProtocolHandler, rendererEntryUrl, APP_SCHEME } from "./protocol";
import { SidecarSupervisor } from "./sidecar";
import { isExternalUrlAllowed, registerIpcHandlers } from "./ipc";
import { BrowserPanelManager } from "./BrowserPanelManager";
import { PANEL_PARTITION } from "./browserPanel";
import { DshSupervisor } from "./dshSupervisor";
import { DshPanel } from "./dshPanel";
import { resetFloatingBrowserWindow } from "./floatingBrowserWindow";
import { TrayManager, trayIconPath } from "./tray";
import {
  setTerminalEventSink,
  terminalSetOutputPaused,
  terminalShutdownAll,
} from "./terminal";
import { wireWindowDevTools } from "./devtools";
import { rememberedWindowBackground } from "./windowBackground";
import { requestWindowHide, restoreAndFocusWindow, showWindow } from "./windowVisibility";
import { abortAllFor } from "./http";
import { registerYouTubeEmbedIdentity } from "./youtubeEmbed";
import { startupMark, gotLock } from "./earlyInit";

let mainWindow: BrowserWindow | null = null;
const sidecar = new SidecarSupervisor();
const browserPanel = new BrowserPanelManager();
// The ad blocker's matching engine lives in the Rust sidecar; Electron main
// only intercepts requests and asks the sidecar whether to block each one.
browserPanel.setBackendGetter(() => sidecar.backendReady());
// The floating mobile-browser overlay: an independent tab set, but the SAME
// session partition as the full-page Browser — a login in one carries over
// to the other, rather than needing two separate sign-ins.
const floatingBrowserPanel = new BrowserPanelManager(PANEL_PARTITION, "floating");
floatingBrowserPanel.setBackendGetter(() => sidecar.backendReady());
const tray = new TrayManager();
// The DeepSeek Harness Web host is spawned lazily on the user's first visit to
// the DSH page (see dshSupervisor.ts) — not at launch, since it is a heavier
// Node/pnpm runtime than the Rust sidecar and most sessions never open it.
const dshSupervisor = new DshSupervisor();
const dshPanel = new DshPanel();

/** Compacts the database in the background shortly after launch, so a local
 *  database file doesn't just grow forever from ordinary editing (SQLite
 *  never reclaims deleted-row space on its own — see Settings' "Compact
 *  database"). Runs at startup rather than on quit: quit handlers only get a
 *  bounded window before the OS/user force the process closed, so a slow
 *  VACUUM on a large file could simply never run; startup has no such
 *  deadline, and this never blocks window creation.
 *
 *  Skipped for a Turso/self-hosted connection: confirmed against a real
 *  sqld instance that it rejects `VACUUM` outright (`unsupported statement:
 *  VACUUM`) — its storage isn't a plain rolling SQLite file, so there is
 *  nothing here for this to reclaim, not just something `db_vacuum` refuses.
 *  Everything is best-effort: any failure (sidecar not up yet, the profile
 *  check itself failing) is swallowed — this is maintenance, not a feature
 *  the user is waiting on. */
async function vacuumInBackground(): Promise<void> {
  try {
    const { port, token } = await sidecar.backendReady();
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const profile = await fetch(`http://127.0.0.1:${port}/invoke/db_get_connection`, {
      method: "POST",
      headers,
      body: "{}",
    }).then((r) => r.json() as Promise<{ caps?: { vacuum?: boolean } }>);
    if (!profile?.caps?.vacuum) return;
    await fetch(`http://127.0.0.1:${port}/invoke/db_vacuum`, { method: "POST", headers, body: "{}" });
  } catch (error) {
    console.error("[startup] vacuum skipped", error);
  }
}

/** Set once the app has committed to quitting: before-quit lets the real
 *  quit pass through instead of preventDefault-ing it again. The updater's
 *  install path sets this early (its installer spawns *before* app.quit(),
 *  so the sidecar drain must already be done by then) — see updater.ts. */
let quitting = false;

/** The app icon as a real file on disk.
 *
 *  Packaged builds get it from `extraResources` (electron-builder.yml); the
 *  `files` list keeps all of core/ out of the asar, so the bundle's own
 *  mac.icon/win.icon/linux.icon are not reachable at runtime. Unpackaged runs
 *  read it straight out of the source tree. */
function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "core", "icons", "icon.png");
}

function broadcastEvent(name: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send("event", { name, payload });
    } catch (error) {
      // A renderer can disappear between isDestroyed() and send(). Terminal
      // output must never turn that normal process race into a main-process
      // exception; render-process-gone owns recovery below.
      console.error("[event] renderer delivery failed", { name, error });
    }
  }
}

/** Reveal the window and hand the renderer's already-mounted `tray://open-dsh`
 *  listener (see useTraySync.ts) the job of navigating — shared by the tray's
 *  "DeepSeek Harness" row, this notification's click, and the global
 *  shortcut, so all three agree on exactly what "open DSH" means. */
function revealDshPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  restoreAndFocusWindow(mainWindow);
  broadcastEvent("tray://open-dsh", null);
}

const DSH_NOTIFY_STRINGS = {
  en: { title: "DeepSeek Harness", body: "A session finished — click to open it." },
  zh: { title: "DeepSeek Harness", body: "会话已完成 — 点击查看。" },
} as const;

/** Outstanding "session finished" notifications, tracked so they can be closed
 *  explicitly. Linux notification daemons (KDE/GNOME/dash-to-dock) render a
 *  count badge on the app's launcher icon equal to the number of unread
 *  notifications from that app, and those notifications OUTLIVE the process
 *  that spawned them — so without closing them, the badge grows with every
 *  finished task and never clears, even across app restarts. Closing on
 *  click / focus / quit is what dismisses the badge. */
const dshNotifications = new Set<Notification>();

/** Closes every outstanding DSH notification and drops the references, so the
 *  launcher badge clears. Safe to call when there are none. */
function closeAllDshNotifications() {
  for (const n of dshNotifications) {
    try { n.close(); } catch { /* already gone */ }
  }
  dshNotifications.clear();
}

/** A session went running→idle while the window wasn't focused (`dsh:task-
 *  finished`, emitted by dshSupervisor's `session.list` poll — see its own
 *  doc). Skipped while focused: the user is already looking at the app, a
 *  system notification would just be noise on top of whatever's already
 *  visible in it. */
function notifyDshTaskFinished() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return;
  if (!Notification.isSupported()) return;
  const strings = DSH_NOTIFY_STRINGS[tray.getLanguage()];
  const notification = new Notification({ title: strings.title, body: strings.body, silent: false });
  dshNotifications.add(notification);
  notification.on("close", () => { dshNotifications.delete(notification); });
  notification.on("click", () => {
    revealDshPage();
    notification.close(); // the user has acknowledged it — drop the badge
  });
  notification.show();
}

/** The one global shortcut TanWords registers: jump straight to the DSH page
 *  from anywhere, even with the window unfocused/hidden/minimized. Configured
 *  in Settings (renderer) and pushed here over `dsh_set_global_shortcut`;
 *  empty string disables it. Re-registering always unregisters the previous
 *  accelerator first — `globalShortcut.register` on a second accelerator
 *  does not release the first, it would just leak a stale binding no UI
 *  offers a way to clear. */
let dshShortcutAccelerator: string | null = null;
function registerDshShortcut(accelerator: string): boolean {
  if (dshShortcutAccelerator) globalShortcut.unregister(dshShortcutAccelerator);
  dshShortcutAccelerator = null;
  if (!accelerator) return true;
  const ok = globalShortcut.register(accelerator, revealDshPage);
  if (ok) dshShortcutAccelerator = accelerator;
  return ok;
}

function createWindow() {
  startupMark("create-window");
  // A plain BrowserWindow is fine as the browser panel's host — its
  // `contentView` has taken child WebContentsViews since Electron 30,
  // no separate BaseWindow needed (see browserPanel.ts).
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // No native title bar on any platform: the renderer owns the drag region
    // and the minimize/maximize/fullscreen/close buttons, so the window
    // controls sit in the same place everywhere.
    frame: false,
    roundedCorners: true,
    // Without this the window's own layer is white, which shows through as a
    // flash on the first frame and during resizes before the renderer repaints.
    // See windowBackground.ts for why this is the previous run's colour.
    backgroundColor: rememberedWindowBackground(),
    // Windows/Linux take the window + taskbar icon from here. macOS ignores it
    // (it uses the .app bundle), which is handled separately below.
    icon: appIconPath(),
    // Keeps the Edit menu's accelerators alive on Windows/Linux without
    // showing a menu bar the UI has no use for (macOS ignores this — its bar
    // lives in the system menu, not the window).
    autoHideMenuBar: true,
    webPreferences: {
      // `import.meta.dirname`, not `__dirname`: this bundle is ESM (the
      // package is "type": "module" and vite-plugin-electron emits ES for
      // main), and unlike electron-vite it injects no __dirname shim.
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Show as soon as Chromium has something painted — the renderer's splash
  // screen is the first thing it paints, so the user gets the product's own
  // launch screen in tens of milliseconds instead of staring at nothing.
  //
  // This deliberately no longer waits for the sidecar. The window used to be
  // held hidden until the handshake landed so it could never show the blank
  // shell React renders while awaiting the backend; the splash *is* that
  // shell's finished state now, so it covers exactly the same gap while being
  // visible the whole time. What used to be dead air is now the launch screen.
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    startupMark("ready-to-show");
    win.show();
    startupMark("window-shown");
    // Native tray/menu construction is useful but irrelevant to the first
    // frame. Deferring it keeps OS menu work out of the visible cold-start
    // path; its state setters are safe before create() and are applied when the
    // menu is built here.
    setImmediate(() => {
      tray.create(trayIconPath());
      startupMark("tray-ready");
    });
  });

  let rendererRecoveryAttempts = 0;
  let rendererStableTimer: ReturnType<typeof setTimeout> | null = null;
  let rendererUnresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  win.webContents.once("did-finish-load", () => startupMark("renderer-loaded"));
  win.webContents.on("did-finish-load", () => {
    terminalSetOutputPaused(false);
    if (rendererStableTimer) clearTimeout(rendererStableTimer);
    rendererStableTimer = setTimeout(() => {
      rendererRecoveryAttempts = 0;
    }, 30_000);
    rendererStableTimer.unref?.();
  });

  // A renderer that exits after ready-to-show leaves the native window alive
  // and indistinguishable from a slow startup: only backgroundColor remains.
  // Keep the Chromium reason in release logs so this cannot fail silently.
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] process gone", details);
    if (rendererUnresponsiveTimer) clearTimeout(rendererUnresponsiveTimer);
    rendererUnresponsiveTimer = null;
    terminalSetOutputPaused(true);
    terminalShutdownAll();
    // The DSH native view lives in this window's contentView independently of
    // the renderer's React tree. The recovery reload below boots a fresh page
    // (route resets to the default), so `DshPage` won't remount to detach it —
    // without this, the still-attached view would float over whichever page
    // loads next. The underlying `dsh` host (and any task it's running) is a
    // separate OS process untouched by this; hide() only detaches the display,
    // so revisiting the DSH page after recovery reattaches it instantly.
    dshPanel.hide();
    if (quitting || win.isDestroyed()) return;
    if (rendererStableTimer) clearTimeout(rendererStableTimer);
    rendererRecoveryAttempts += 1;
    if (rendererRecoveryAttempts > 3) {
      console.error("[renderer] automatic recovery stopped after three rapid crashes");
      return;
    }
    setTimeout(() => {
      if (!quitting && !win.isDestroyed()) win.webContents.reload();
    }, Math.min(250 * (2 ** (rendererRecoveryAttempts - 1)), 1_000));
  });
  win.webContents.on("unresponsive", () => {
    console.error("[renderer] unresponsive; pausing terminal output");
    terminalSetOutputPaused(true);
    if (rendererUnresponsiveTimer) clearTimeout(rendererUnresponsiveTimer);
    rendererUnresponsiveTimer = setTimeout(() => {
      rendererUnresponsiveTimer = null;
      if (quitting || win.isDestroyed() || win.webContents.isDestroyed()) return;
      console.error("[renderer] still unresponsive after 10s; forcing recovery");
      win.webContents.forcefullyCrashRenderer();
    }, 10_000);
    rendererUnresponsiveTimer.unref?.();
  });
  win.webContents.on("responsive", () => {
    if (rendererUnresponsiveTimer) clearTimeout(rendererUnresponsiveTimer);
    rendererUnresponsiveTimer = null;
    terminalSetOutputPaused(false);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error("[renderer] main frame failed to load", { code, description, url });
  });

  // The splash holds until the backend answers, so the app underneath is never
  // uncovered before it can serve a query. The renderer waits on that by
  // *asking* — `tanwords:backend`, which it already invokes for the port and
  // token — rather than on an event from here: with a local database the
  // handshake lands in under 20ms, well before the renderer could subscribe,
  // and a broadcast that early would be missed by the one listener that needs
  // it.

  // Deny popups from the main UI (the browser panel's own WebContentsViews
  // have their own, separate setWindowOpenHandler — see browserPanel.ts).
  // The allowlist matches shell:open's — an unvalidated openExternal is an
  // RCE vector on Windows, and several renderers fall back to window.open
  // with a remote-controlled URL (feeds, HN, AI output).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Never let the app window navigate away from its own entry point. Remote
  // HTML is injected into this window unsanitized (HN comments use
  // dangerouslySetInnerHTML) and it carries plain <a href> links — one click
  // would load arbitrary remote content *with the privileged preload
  // attached*, which reaches window.tanwords (file:write, the sidecar token).
  // Legitimate outbound links go through shell.openExternal instead.
  const entryOrigin = new URL(
    process.env["VITE_DEV_SERVER_URL"] ?? rendererEntryUrl(),
  ).origin;
  win.webContents.on("will-navigate", (event, url) => {
    let allowed: boolean;
    try {
      // Same-origin reload/navigation is fine (Vite HMR, the app:// entry).
      // about:blank and data: are emitted transiently by some Chromium paths.
      allowed =
        new URL(url).origin === entryOrigin ||
        url === "about:blank" ||
        url.startsWith(`${APP_SCHEME}://`);
    } catch {
      allowed = false;
    }
    if (allowed) return;
    event.preventDefault();
    // A clicked http(s) link should still do what the user meant — just in
    // the system browser, not in the privileged window.
    if (isExternalUrlAllowed(url)) void shell.openExternal(url);
  });

  browserPanel.setWindow(win);
  floatingBrowserPanel.setWindow(win);
  dshPanel.setWindow(win);
  wireWindowDevTools(win);

  const emitWindowState = () => {
    if (win.isDestroyed()) return;
    broadcastEvent("window:state-changed", {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    });
  };
  win.on("maximize", emitWindowState);
  win.on("unmaximize", emitWindowState);
  win.on("enter-full-screen", emitWindowState);
  win.on("leave-full-screen", emitWindowState);

  // Set by vite-plugin-electron when it spawns Electron from `vite dev`
  // (electron-vite's equivalent was ELECTRON_RENDERER_URL).
  const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadURL(rendererEntryUrl());
  }

  // A reload or a close orphans any provider stream still being pumped into
  // this renderer; without this they'd keep downloading into a dead sender.
  const contentsId = win.webContents.id;
  win.webContents.on("did-start-navigation", ({ isSameDocument }) => {
    if (!isSameDocument) {
      abortAllFor(contentsId);
      terminalShutdownAll();
    }
  });

  mainWindow = win;
  tray.setWindow(win);
  // Focusing the window means the user has returned to the app and can see
  // its state directly — close any outstanding "session finished"
  // notifications so the launcher badge clears (Linux daemons badge the icon
  // by unread-notification count). See notifyDshTaskFinished.
  win.on("focus", () => closeAllDshNotifications());
  // Parity with the Tauri-era tray (core's CloseRequested handler): clicking
  // the title-bar X hides the app into the tray, it does not quit — playback
  // and the tray menu keep working behind it. Only the tray's Quit (or an
  // updater install), which both come through with `quitting` already set,
  // lets a close actually destroy the window.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    requestWindowHide(win);
  });
  win.on("closed", () => {
    abortAllFor(contentsId);
    mainWindow = null;
    browserPanel.reset();
    floatingBrowserPanel.reset();
    dshPanel.reset();
    resetFloatingBrowserWindow();
  });
}

if (gotLock) {
  // A duplicate launch surfaces the instance the user already has rather than
  // doing nothing — otherwise double-clicking the app while it's running reads
  // as "the app didn't start".
  const focusExistingWindow = () => {
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      showWindow(win);
      win.focus();
      return;
    }
    // No window to focus: the second launch landed while the first was still
    // starting up (createWindow hasn't run yet), or the window was torn down
    // mid-quit. Only build one once the app is ready — before that,
    // whenReady()'s own createWindow() will.
    if (app.isReady()) createWindow();
  };

  app.on("second-instance", focusExistingWindow);

  app.whenReady().then(() => {
    // macOS takes the dock icon from the .app bundle, which unpackaged runs
    // don't have — they run stock Electron.app and so show the Electron logo.
    // (Under Tauri this never came up: `tauri dev` built a real bundle.) Set it
    // by hand for dev; packaged builds already have the right one from
    // mac.icon, and overriding there would only risk a worse-quality icon than
    // the .icns.
    if (process.platform === "darwin" && !app.isPackaged) {
      try {
        app.dock?.setIcon(appIconPath());
      } catch (error) {
        console.warn("[icon] could not set dev dock icon:", error);
      }
    }

    registerAppProtocolHandler();
    registerYouTubeEmbedIdentity(session.defaultSession);

    sidecar.setEventSink(broadcastEvent);
    sidecar.start();

    browserPanel.setEventSink(broadcastEvent);
    floatingBrowserPanel.setEventSink(broadcastEvent);
    dshPanel.setEventSink(broadcastEvent);
    dshSupervisor.setEventSink((name, payload) => {
      broadcastEvent(name, payload);
      if (name === "dsh:task-finished") notifyDshTaskFinished();
      // A "failed" status can arrive after a host that briefly printed its
      // ready line then crashed (e.g. EMFILE exhausting inotify watchers).
      // In that race `dsh_show` already resolved and attached a native view
      // pointing at the now-dead host; if we leave it attached it composites
      // above the renderer's failure modal and intercepts clicks, freezing
      // the UI. Hide the native view from main the instant the host is
      // reported dead — the renderer's own visibility effect hides it too,
      // but only when its `status` dep re-runs (see DshPage.tsx). Hiding
      // here is authoritative and survives any renderer-side dep mistake.
      if (name === "dsh:status" && (payload as { status?: string }).status === "failed") {
        dshPanel.hide();
      }
    });

    tray.setEventSink(broadcastEvent);

    setTerminalEventSink(broadcastEvent);

    // `window.tanwords.backend` resolves once this handshake resolves — the
    // preload just forwards this single invoke() call as-is, so a renderer
    // that mounts before the sidecar is ready naturally queues on it
    // (migration plan §8's "startup ordering inverts").
    ipcMain.handle("tanwords:backend", async () => sidecar.backendReady());

    // Loading electron-updater (or the custom macOS updater) is not needed to
    // paint or use the app. The renderer's silent check already waits five
    // seconds, so import the platform implementation only when that check (or a
    // manual one) actually happens.
    let updaterPromise: Promise<ReturnType<typeof import("./updater")["initUpdater"]>> | null = null;
    const getUpdater = () => {
      updaterPromise ??= import("./updater").then(({ initUpdater }) => initUpdater(broadcastEvent, async () => {
        quitting = true;
        await sidecar.shutdown().catch(() => {});
      }));
      return updaterPromise;
    };
    const updater = {
      check: async () => (await getUpdater()).check(),
      downloadAndInstall: async () => (await getUpdater()).downloadAndInstall(),
    };
    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      broadcastEvent,
      updater,
      browserPanel,
      floatingBrowserPanel,
      tray,
      dshSupervisor,
      dshPanel,
      setDshShortcut: registerDshShortcut,
    });

    createWindow();
    void sidecar.backendReady().then(() => {
      startupMark("sidecar-ready");
      void vacuumInBackground();
    });

    app.on("activate", () => {
      // Close-means-hide leaves the window alive but hidden, so a macOS dock
      // click has an existing window to resurface — not zero windows to
      // recreate. The recreate branch stays for a genuinely destroyed window.
      const win = mainWindow;
      if (win && !win.isDestroyed()) {
        showWindow(win);
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Global shortcuts are OS-wide registrations outliving any window; leaving
    // one bound after quit would eat a key combo system-wide until the OS
    // reaps the process. `will-quit` (not `before-quit`, which this app
    // preventDefaults for the hide-to-tray dance) is Electron's documented
    // point for this cleanup.
    app.on("will-quit", () => globalShortcut.unregisterAll());
  });

  // This only fires during a real quit now: close-means-hide keeps the
  // window alive, so every window being gone implies `quitting` was set.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    // Close outstanding DSH notifications before exit: Linux notification
    // daemons keep notifications from exited processes, so without this the
    // launcher badge would survive a restart.
    closeAllDshNotifications();
    terminalShutdownAll();
    void sidecar.shutdown().finally(() => {
      // The DSH host has no stdin-EOF shutdown path; the supervisor SIGTERMs
      // it (then SIGKILLs after a timeout) so an ungraceful app exit can't
      // orphan the loopback `dsh --profile web` process.
      void dshSupervisor.shutdown().finally(() => {
        app.exit();
      });
    });
  });
}
