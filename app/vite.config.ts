/** The app's build config: one plain Vite project (the renderer) plus
 *  vite-plugin-electron, which builds the main and preload bundles as nested
 *  Vite builds and boots/reloads Electron during `vite dev`.
 *
 *  This replaced electron-vite. The output layout is unchanged — out/main,
 *  out/preload, out/renderer — because electron-builder.yml ships `out/**` and
 *  electron/main/protocol.ts serves `out/renderer` over the app:// scheme.
 *
 *  Vitest reads vitest.config.ts, not this file, so tests never spawn Electron. */
import { defineConfig } from "vite";
import electron from "vite-plugin-electron";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: ".",
  // Electron loads the renderer from a custom app:// scheme (plan §9.1), so
  // asset URLs must be relative to that scheme's root rather than absolute
  // filesystem paths.
  base: "./",
  plugins: [
    react(),
    electron([
      {
        entry: path.resolve(import.meta.dirname, "electron/main/index.ts"),
        // Default argv is ['.', '--no-sandbox']; drop the flag so a dev run
        // keeps the same Chromium sandbox the packaged app runs under
        // (the main window sets `sandbox: true`).
        onstart: ({ startup }) => void startup(["."]),
        vite: {
          build: {
            outDir: "out/main",
            // package.json has "type": "module", so the plugin emits ESM here
            // and `lib.fileName` gives out/main/index.js — the "main" field.
            minify: false,
          },
        },
      },
      {
        // Preload goes through rollupOptions.input rather than `entry`: the
        // `entry` shortcut builds via build.lib, which would inherit the ESM
        // format from package.json's "type": "module".
        //
        // Force CJS despite that — Electron's sandboxed preload loader
        // (contextIsolation + sandbox: true, which this app uses for its main
        // window) does not reliably load ESM preload scripts across the
        // Electron/Node combinations this app targets. A `.cjs` extension
        // sidesteps Node's package.json "type": "module" inference for this
        // one file.
        onstart: ({ reload }) => reload(),
        vite: {
          build: {
            outDir: "out/preload",
            minify: false,
            rollupOptions: {
              input: path.resolve(import.meta.dirname, "electron/preload/index.ts"),
              output: {
                format: "cjs",
                entryFileNames: "index.cjs",
                // The preload must stay a single file; rolldown
                // spells that `codeSplitting: false` now.
                codeSplitting: false,
              },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: {
    outDir: "out/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "index.html"),
    },
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5420,
    strictPort: true,
  },
});
