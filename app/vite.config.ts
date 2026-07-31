/** Vitest's config only.
 *
 *  The app itself is built by electron.vite.config.ts — this file exists so
 *  `vitest` can resolve `@/…` and render components under jsdom. Keep the
 *  alias here in sync with the renderer alias there. */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
