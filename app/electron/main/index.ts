import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { registerAppProtocolHandler, rendererEntryUrl } from "./protocol";
import { SidecarSupervisor } from "./sidecar";
import { registerIpcHandlers } from "./ipc";
import { initUpdater } from "./updater";

// Single instance: same purpose `tauri-plugin-single-instance` served —
// stop a duplicate SQLite connection / duplicate MCP port bind from a
// second app launch (migration plan §5).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
const sidecar = new SidecarSupervisor();

function broadcastEvent(name: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("event", { name, payload });
  }
}

function createWindow() {
  // NOTE: Task 4 turns this into a BaseWindow hosting the UI as its own
  // WebContentsView, so browser-panel WebContentsViews can layer above it.
  // A plain BrowserWindow is the correct shape for this task.
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

  win.once("ready-to-show", () => win.show());

  // Deny popups from the main UI (the browser panel's own WebContentsViews
  // get their own, separate setWindowOpenHandler in Task 4).
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadURL(rendererEntryUrl());
  }

  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
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
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Standard Electron boilerplate. Task 4's tray work intercepts the
  // window's own "close" event to hide-to-tray instead of destroying it, so
  // this only fires once the user (or the `quitting` flag Task 4 adds)
  // actually lets the window close.
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
