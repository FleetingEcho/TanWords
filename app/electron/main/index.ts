import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { registerAppProtocolHandler, rendererEntryUrl } from "./protocol";
import { SidecarSupervisor } from "./sidecar";
import { registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater";
import { BrowserPanelManager } from "./browserPanel";
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

// No File/Edit/View/Window menu bar — the UI has its own navigation and
// nothing here depends on menu accelerators.
Menu.setApplicationMenu(null);

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
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  browserPanel.setWindow(win);

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
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
    registerAppProtocolHandler();

    sidecar.setEventSink(broadcastEvent);
    sidecar.start();

    browserPanel.setEventSink(broadcastEvent);

    // `window.tanwords.backend` resolves once this handshake resolves — the
    // preload just forwards this single invoke() call as-is, so a renderer
    // that mounts before the sidecar is ready naturally queues on it
    // (migration plan §8's "startup ordering inverts").
    ipcMain.handle("tanwords:backend", async () => sidecar.backendReady());

    const updater = initUpdater(broadcastEvent);
    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      broadcastEvent,
      updater,
      browserPanel,
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

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void sidecar.shutdown().finally(() => {
      app.exit();
    });
  });
}
