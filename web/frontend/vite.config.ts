/** Web build: a plain Vite SPA. The Rust web server (web/server) serves
 *  `dist/` in production; in dev `bun run dev` proxies the API to it.
 *
 *  Vitest reads vitest.config.ts, not this file. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5420,
    strictPort: true,
    // Dev proxy to the web server (default TANWORDS_PORT).
    proxy: {
      "/invoke": "http://127.0.0.1:8740",
      "/api": "http://127.0.0.1:8740",
      "/events": "http://127.0.0.1:8740",
    },
  },
});
