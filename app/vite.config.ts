import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The Tauri compatibility bridge. This is what keeps ~48 UI files —
      // and their existing vitest mocks, which mock these same specifiers —
      // unchanged through the Electron migration. See src/bridge/README.md.
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
    },
  },
  clearScreen: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
