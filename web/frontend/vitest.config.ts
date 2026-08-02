/** Vitest's config only.
 *
 *  Deliberately separate from vite.config.ts: that file carries
 *  vite-plugin-electron, and vitest picks up vite.config.ts by default — a
 *  test run would otherwise build the main/preload bundles too. Keep the `@/…`
 *  alias here in sync with the renderer alias there. */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
