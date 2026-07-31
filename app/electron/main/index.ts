import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { registerAppProtocolHandler, rendererEntryUrl } from "./protocol";
import { SidecarSupervisor } from "./sidecar";
import { registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater";
import { BrowserPanelManager } from "./browserPanel";

// Single instance: same purpose `tauri-plugin-single-instance` served —
// stop a duplicate SQLite connection / duplicate MCP port bind from a
// second app launch (migration plan §5).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// No File/Edit/View/Window menu bar — the UI has its own navigation and
// nothing here depends on menu accelerators.
Menu.setApplicationMenu(null);

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

  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
    browserPanel.reset();
  });
}

if (gotLock) {
  app.on("second-instance", () => {
    const win = mainWindow;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

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
