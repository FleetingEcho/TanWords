import { app, Menu } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const startupStartedAt = Date.now();
const startupMark = (stage: string) => {
  console.log(`[startup] ${stage} +${Date.now() - startupStartedAt}ms`);
};

// Match electron-builder.yml's appId. Windows uses this identity to associate
// the running window with the installed shortcut (including its icon) instead
// of falling back to Electron's process identity or a stale taskbar grouping.
if (process.platform === "win32") app.setAppUserModelId("com.tanner.tanwords");

// On affected Windows GPU/driver combinations Chromium can lose its shared
// image mailbox while the renderer itself keeps running. The result is a live
// app (backend calls and accessibility tree included) whose window presents
// only its dark background. TanWords is predominantly text UI, so reliable
// software compositing is preferable to a faster but intermittently black
// launch. Electron requires this call before app readiness/window creation.
if (process.platform === "win32") app.disableHardwareAcceleration();

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

export { startupMark, gotLock };
