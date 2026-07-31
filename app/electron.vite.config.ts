import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
      alias: { "@": path.resolve(__dirname, "./src") },
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
