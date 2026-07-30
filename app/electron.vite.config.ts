import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Renderer alias table is the Tauri compatibility bridge (see vite.config.ts's
// own copy and src/bridge/README.md) — duplicated here rather than imported
// because electron-vite's renderer config is its own Vite instance, not a
// consumer of the root vite.config.ts (that one is vitest's config only).
const rendererAliases = {
  "@": path.resolve(__dirname, "./src"),
  "@tauri-apps/api/core": path.resolve(__dirname, "./src/bridge/core.ts"),
  "@tauri-apps/api/event": path.resolve(__dirname, "./src/bridge/event.ts"),
  "@tauri-apps/api/window": path.resolve(__dirname, "./src/bridge/window.ts"),
  "@tauri-apps/api/app": path.resolve(__dirname, "./src/bridge/app.ts"),
  "@tauri-apps/plugin-dialog": path.resolve(__dirname, "./src/bridge/dialog.ts"),
  "@tauri-apps/plugin-shell": path.resolve(__dirname, "./src/bridge/shell.ts"),
  "@tauri-apps/plugin-http": path.resolve(__dirname, "./src/bridge/http.ts"),
  "@tauri-apps/plugin-clipboard-manager": path.resolve(__dirname, "./src/bridge/clipboard.ts"),
  "@tauri-apps/plugin-updater": path.resolve(__dirname, "./src/bridge/updater.ts"),
  "@tauri-apps/plugin-process": path.resolve(__dirname, "./src/bridge/process.ts"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: path.resolve(__dirname, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: path.resolve(__dirname, "electron/preload/index.ts"),
        // Force CJS despite this package's "type": "module" — Electron's
        // sandboxed preload loader (contextIsolation + sandbox: true, which
        // this app uses for its main window) does not reliably load ESM
        // preload scripts across the Electron/Node combinations this app
        // targets. A `.cjs` extension sidesteps Node's package.json
        // "type": "module" inference for this one file.
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    // Electron loads the renderer from a custom app:// scheme (plan §9.1), so
    // asset URLs must be relative to that scheme's root rather than absolute
    // filesystem paths.
    base: "./",
    plugins: [react()],
    resolve: {
      alias: rendererAliases,
    },
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: path.resolve(__dirname, "index.html"),
      },
      chunkSizeWarningLimit: 1600,
    },
    server: {
      port: 5420,
      strictPort: true,
    },
  },
});
