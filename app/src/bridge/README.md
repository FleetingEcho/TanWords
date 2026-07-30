# Tauri compatibility bridge

Each file here re-exports the **same names with the same signatures** as the
`@tauri-apps/*` module it replaces. `vite.config.ts` aliases the Tauri import
specifiers onto these, so the ~48 UI files that import them are never edited.

Rule: if you find yourself editing a file under `src/components`, `src/hooks`,
`src/store` or `src/providers` to make Electron work, stop — the fix belongs in
a bridge module instead. The two documented exceptions are in the migration
plan (`lib/localAudioSrc.ts` and one line of `lib/localDocs.ts`).

| Bridge file | Replaces | Routes to |
| --- | --- | --- |
| `core.ts` | `@tauri-apps/api/core` | sidecar HTTP, except `browser_*`/`tray_*` -> main |
| `event.ts` | `@tauri-apps/api/event` | sidecar SSE + main-process events, merged |
| `window.ts` | `@tauri-apps/api/window` | main (see plan §8.4 — offset must be 0) |
| `app.ts` | `@tauri-apps/api/app` | main (`app.getVersion()`) |
| `dialog.ts` | `@tauri-apps/plugin-dialog` | main (`dialog.showOpenDialog` / `showSaveDialog`) |
| `shell.ts` | `@tauri-apps/plugin-shell` | main (`shell.openExternal`) |
| `clipboard.ts` | `@tauri-apps/plugin-clipboard-manager` | main (`clipboard`) |
| `http.ts` | `@tauri-apps/plugin-http` | main (`net.fetch`) — **streaming, hardest one** |
| `updater.ts` | `@tauri-apps/plugin-updater` | main (`electron-updater`) |
| `process.ts` | `@tauri-apps/plugin-process` | main (`app.relaunch`) |
