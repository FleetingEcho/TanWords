import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAppProtocolHandler, rendererEntryUrl, APP_SCHEME } from "./protocol";
import { SidecarSupervisor } from "./sidecar";
import { isExternalUrlAllowed, registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater";
import { BrowserPanelManager } from "./browserPanel";
import { TrayManager, trayIconPath } from "./tray";
import { wireWindowDevTools } from "./devtools";
import { rememberedWindowBackground } from "./windowBackground";
import { abortAllFor } from "./http";

// Pin the app name before anything reads a path from it. `requestSingleInstance
// Lock()` is keyed on `userData`, which Electron derives from `app.getName()` —
// and that resolves from package.json's `productName` (absent here) falling back
// to `name`, while electron-builder.yml carries its own `productName: TanWords`
// for the bundle. If those ever disagree between a dev run and a packaged build,
// the two get *different* userData dirs, therefore different locks, and both can
// run at once against the one SQLite file the sidecar always opens at
// `dirs::data_dir()/tanwords/`. Setting it explicitly removes that coupling.
//
// "tanwords" (lowercase) is deliberate: it matches both the existing dev
// userData dir and the sidecar's data dir. No packaged Electron build has
// shipped yet, so nothing is orphaned by fixing it here.
app.setName("tanwords");

// Linux dev only: GNOME-style docks resolve a running window's icon through a
// .desktop file whose StartupWMClass matches the window class — an unpackaged
// Electron run has no desktop file, so `bun run dev` shows the generic gear no
// matter what `BrowserWindow.icon` says. Register a dev desktop entry pointing
// at this checkout's icon (user-level dir, no root), rewritten on each start
// so moving the repo can't leave a stale path behind. Packaged builds get
// their entry from electron-builder instead and never take this branch.
if (process.platform === "linux" && !app.isPackaged) {
  try {
    const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
    const contents = [
      "[Desktop Entry]",
      "Name=TanWords (dev)",
      `Exec=${process.execPath} ${app.getAppPath()}`,
      "Terminal=false",
      "Type=Application",
      `Icon=${path.join(app.getAppPath(), "core", "icons", "icon.png")}`,
      // The window class is what setName("tanwords") just pinned — keep aligned.
      "StartupWMClass=tanwords",
      "Categories=Education;",
      "",
    ].join("\n");
    const file = path.join(desktopDir, "tanwords-dev.desktop");
    fs.mkdirSync(desktopDir, { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
      fs.writeFileSync(file, contents);
    }
    app.setDesktopName("tanwords-dev.desktop");
  } catch (error) {
    console.warn("[icon] could not register dev desktop entry:", error);
  }
}

// Single instance: same purpose `tauri-plugin-single-instance` served — stop a
// duplicate SQLite connection / duplicate MCP port bind from a second app
// launch (migration plan §5). Everything below that touches app state is
// guarded by `gotLock`, so a losing instance sets up nothing before exiting.
//
// This covers the Electron process. The sidecar is covered separately and by a
// different mechanism: it exits on stdin EOF (`shutdown_on_stdin_eof` in
// core/src/server.rs), so it dies with its parent even when Electron is killed
// ungracefully rather than being left orphaned holding the database.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // exit(), not quit(): quit() is a *deferred, graceful* shutdown that lets
  // this process carry on initialising until the event loop unwinds — a
  // duplicate launch should be gone immediately, and the running instance has
  // already been signalled to focus itself via "second-instance".
  app.exit(0);
}

// A trimmed menu rather than `null`. The UI has its own navigation and wants
// no File/View menu, but Chromium routes the renderer's clipboard, undo and
// select-all shortcuts (Cmd/Ctrl + C/V/X/Z/A) through the application menu's
// role accelerators — with no menu at all, paste silently stops working in
// every input in the app, and on macOS Cmd+Q goes with it. So keep exactly the
// roles those shortcuts need and nothing else.
//
// macOS shows the menu bar in the system bar, outside the window, so it costs
// no screen real estate. On Windows/Linux the bar is suppressed per-window via
// `autoHideMenuBar` below, which hides it without unbinding the accelerators.
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" as const },
    ...(process.platform === "darwin" ? [{ role: "windowMenu" as const }] : []),
  ]),
);

// ── Memory tuning ──────────────────────────────────────────────────────────
// Chromium sizes its heaps for a general-purpose browser on the assumption it
// owns the machine. This app is a single-window desktop tool whose heavy work
// (SQLite, ONNX/TTS, audio decode, search) lives in the Rust sidecar, so those
// defaults are far larger than anything the renderer needs.

// Chromium keeps a fully-initialized spare renderer process warm so the *next*
// navigation to a new site starts instantly. That's a browser optimisation:
// here the only thing that navigates across sites is the browser panel, and it
// already pays a page load. The spare is a whole idle renderer (~60-90MB) that
// exists purely to be fast once.
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");

// V8 heap ceiling. The app's steady-state working set is small; the large
// allocations are document parses, and those are transient and happen in the
// worker. Capping this makes V8 collect at a smaller resident size rather than
// letting the heap drift toward its multi-GB default before it feels any
// pressure. If parsing a very large vault ever OOMs, raise this first.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=512");

let mainWindow: BrowserWindow | null = null;
const sidecar = new SidecarSupervisor();
const browserPanel = new BrowserPanelManager();
const tray = new TrayManager();

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
    win.webContents.send("event", { name, payload });
  }
}

// Upper bound on how long createWindow() will hold the window hidden waiting
// for the sidecar handshake. Past this, show anyway — a stuck/missing sidecar
// binary should surface as an error inside the app, not an invisible window.
const STARTUP_SHOW_TIMEOUT_MS = 15000;

function createWindow() {
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

  // Hold the window hidden past Chromium's first paint (an empty root div)
  // until the sidecar handshake resolves too, so the window never shows the
  // blank/unstyled shell React renders while still awaiting the backend.
  const readyToShow = new Promise<void>((resolve) => win.once("ready-to-show", resolve));
  const backendReady = sidecar.backendReady().then(
    () => {},
    () => {},
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, STARTUP_SHOW_TIMEOUT_MS));
  void Promise.all([readyToShow, Promise.race([backendReady, timeout])]).then(() => {
    if (!win.isDestroyed()) win.show();
  });

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
    if (!isSameDocument) abortAllFor(contentsId);
  });

  mainWindow = win;
  tray.setWindow(win);
  win.on("closed", () => {
    abortAllFor(contentsId);
    mainWindow = null;
    browserPanel.reset();
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
      win.show();
      win.focus();
      return;
    }
    // No window to focus. Either the second launch landed while the first was
    // still starting up (createWindow hasn't run yet), or this is macOS, where
    // the app deliberately outlives its last window. Only build one once the
    // app is ready — before that, whenReady()'s own createWindow() will.
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

    sidecar.setEventSink(broadcastEvent);
    sidecar.start();

    browserPanel.setEventSink(broadcastEvent);

    tray.setEventSink(broadcastEvent);
    tray.create(trayIconPath());

    // `window.tanwords.backend` resolves once this handshake resolves — the
    // preload just forwards this single invoke() call as-is, so a renderer
    // that mounts before the sidecar is ready naturally queues on it
    // (migration plan §8's "startup ordering inverts").
    ipcMain.handle("tanwords:backend", async () => sidecar.backendReady());

    const updater = initUpdater(broadcastEvent, async () => {
      quitting = true;
      await sidecar.shutdown().catch(() => {});
    });
    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      broadcastEvent,
      updater,
      browserPanel,
      tray,
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Standard Electron boilerplate. This only fires once the user actually
  // lets the window close.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void sidecar.shutdown().finally(() => {
      app.exit();
    });
  });
}
