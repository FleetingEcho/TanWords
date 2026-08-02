# Unified GUI plan

One React/TypeScript GUI source for both the Electron desktop app and the
browser/web edition, served by two host runtimes:

```text
app/electron  -> Electron shell: window, sidecar lifecycle, native host APIs
app/src       -> the only GUI source
app/core      -> core Rust library shared by the desktop sidecar and web server
web/server    -> network backend: auth, per-user runtimes, SPA hosting
```

Status: implemented. `web/frontend` was removed after the shared renderer
build was verified. Written 2026-08-02.

---

## 1. Why this is feasible

The two frontends are already forks of the same source tree:

- `app/src` and `web/frontend/src` share 356 files by relative path.
- 255 of those files are byte-for-byte identical.
- 101 differ, mostly because the web edition added responsive behavior and
  replaced Electron host APIs with browser equivalents.
- `app/src` has about 60 unique files, almost all desktop-only: Music,
  Browser, TTS, LocalDocs, Updater, Tray, MCP settings.
- `web/frontend` has about 11 unique files: auth, browser platform helpers,
  mobile viewport hooks, and the FSRS review panel.

The transport is already the same seam. Both the Electron renderer and the web
frontend call `POST /invoke/{command}` and consume SSE events; only the token
source and asset URL shape differ. That makes a single GUI source practical
without moving any core business logic into the renderer.

## 2. Decisions already made

These decisions are fixed for the first pass:

1. `app/src` stays the canonical GUI source. `web/frontend` has been removed
   after its useful changes were merged back.
2. `web/server` stays. It serves the same built renderer instead of a second
   frontend tree.
3. Desktop-only features are hidden on the web edition. They are not replaced
   with web equivalents in this phase:
   - Music
   - In-app Browser panel
   - Local TTS model management / native TTS
   - LocalDocs (OS folder browsing)
   - Updater
   - Tray
   - MCP settings
4. The GUI is flexible by default everywhere.
5. Settings exposes a toggle to disable flexible mode and use the fixed
   desktop-style layout instead.

## 3. Target architecture

### 3.1 One renderer, two hosts

The renderer detects its host at runtime:

- Electron: `window.tanwords` is present. Backend credentials come from the
  preload handshake.
- Web: `window.tanwords` is absent. The app enters the login/auth flow and uses
  the session token from `web/server`.

All cross-host operations go through a single platform adapter:

```text
src/platform/
  types.ts       Host kind + capability flags
  index.ts       Runtime platform selector
  invoke.ts      Desktop sidecar RPC or web session RPC
  events.ts      Desktop SSE or web SSE
  assets.ts      Desktop path-based asset URLs or web id-based asset URLs
  files.ts       Native dialogs or browser file inputs/downloads
  shell.ts       openExternal, clipboard, import/export helpers
```

`web/frontend/src/api/platform.ts` already contains most browser-side file,
clipboard, import/export, and shell helpers. It should be promoted into the
shared platform layer rather than rewritten.

### 3.2 Capability flags

The adapter exposes a small capability object:

```ts
type HostCapabilities = {
  desktop: boolean;
  auth: boolean;
  browser: boolean;
  music: boolean;
  localDocs: boolean;
  mcp: boolean;
  tray: boolean;
  updater: boolean;
  nativeTts: boolean;
};
```

Consumers:

- `MainLayout` filters nav items.
- `SettingsPage` filters sections.
- `App` gates startup effects such as update checks, tray sync, TTS preload,
  and local-docs cleanup.
- Desktop-only modules are imported lazily so web builds never execute their
  startup side effects.

## 4. Flexible and fixed layout modes

### 4.1 Semantics

`layoutMode` lives in settings and has two user-visible values:

- `flexible` (default): responsive layout. Wide viewports use the sidebar;
  narrow viewports use the mobile shell with a bottom tab bar, single-pane
  pages, overlays, and safe-area handling.
- `fixed`: the classic desktop layout. The sidebar is always shown and pages
  keep their desktop two-pane behavior.

Confirmed safety rule:

- `flexible` is the default for every host.
- `fixed` is respected on desktop-sized viewports (`>= 768px`).
- Below that width, the app stays in mobile-safe flexible mode even if
  `fixed` is selected, because a 375px-wide desktop layout is not usable.

### 4.2 Root-level mode, not just a sidebar flag

The current `layoutStore` only tracks sidebar collapse. Flexible layout also
changes page composition:

- two-pane pages collapse to one pane;
- detail views become overlays or sub-pages;
- inputs follow the mobile visual viewport;
- player bars dock differently;
- touch targets and safe-area insets differ.

Therefore the root shell should expose `data-layout-mode="flexible|fixed"` on a
container above every page. Component CSS and hooks can branch on that mode
instead of assuming the browser width alone.

Where the web edition already uses `useIsNarrow`, the hook should become
mode-aware:

```ts
function useIsNarrowLayout(): boolean {
  const layoutMode = useLayoutStore((s) => s.layoutMode);
  return layoutMode === "flexible" && useIsNarrow();
}
```

### 4.3 Settings UI

Add one Settings control under General:

```text
Flexible layout: ON / OFF
```

`ON` is the default and maps to `layoutMode = "flexible"`. `OFF` maps to
`layoutMode = "fixed"`. The value is persisted through the existing settings
store, which already persists to the database and has a localStorage cache.

## 5. Merge direction

Use `app/src` as the base and merge the web edition's useful changes into it:

1. Promote the web API/platform files into `app/src/platform/`.
2. Merge the responsive changes from the 101 differing shared files.
3. Keep every desktop-only file in place, but gate it behind capability flags.
4. Reconcile desktop-only code that touches `window.tanwords` so it cannot run
   or break the web bundle.

Key files to touch:

- `app/src/App.tsx`: host detection, auth gate, gated startup effects.
- `app/src/components/Layout/Sidebar.tsx`: capability-filtered nav, both layout
  modes.
- `app/src/components/Layout/CommandBar.tsx`: hide Electron-only controls on
  web.
- `app/src/store/layoutStore.ts`: add `layoutMode`.
- `app/src/store/settingsStore.ts`: persist the new setting.
- `app/src/providers/*`: route web requests through the existing AI proxy.
- `app/src/hooks/useDB*.ts`, `app/src/hooks/useMcpSync.ts`: make sure imports
  stay host-neutral.

## 6. Web server changes

`web/server` already serves a static SPA via `TANWORDS_WEB_DIST`. After the
merge:

- point `web_dist` at the shared renderer build output, for example
  `app/out/renderer`;
- keep auth, per-user runtimes, `/invoke`, SSE, asset serving, import/export,
  and the AI proxy unchanged;
- keep `BLOCKED_COMMANDS` as the server-side security boundary for commands
  that must not run on web;
- delete `web/frontend` only after the web host passes verification.

## 7. Migration milestones

### M1: Platform adapter and capability gates

- Add `src/platform/`.
- Add `layoutMode` to settings/layout stores.
- Gate nav and settings by capability flags.
- Confirm Electron and web builds still run with no feature regressions.

### M2: Merge responsive UI

- Diff the 101 shared files between `app/src` and `web/frontend/src`.
- Port web responsive behavior into `app/src`.
- Add the FSRS review panel from web if it is not already present.
- Keep desktop-only components working in `fixed` mode.

### M3: Layout modes in every page

- Root `data-layout-mode` attribute.
- Flexible shell: sidebar on wide, bottom tab bar on narrow.
- Fixed shell: sidebar always, no bottom tab bar.
- Two-pane pages collapse only in flexible/narrow mode.
- Mobile player, modal, keyboard, and safe-area behavior only in flexible mode.

### M4: Single build + web server

- Point `web/server` at the unified renderer output.
- Run web verification, then remove `web/frontend`.
- Update `README.md` and `web/README.md` to describe the unified GUI.

### M5: Verification

- `cd app && bun run typecheck`
- `cd app && bun run test:run`
- Electron: fixed layout and flexible layout at desktop and narrow window sizes.
- Web: desktop browser, mobile viewport, login flow, responsive pages.
- Verify desktop-only features are hidden on web and still present in Electron.

## 8. Risks and notes

- The 101 differing files need a careful per-file merge. Most are expected to be
  small responsive or adapter changes, but a few contain real functional
  differences (auth, import/export, providers).
- The renderer must never expose the desktop sidecar token to web code.
  Platform selection should be one-way: Electron chooses the sidecar adapter;
  web code cannot request it.
- AI provider key handling is already different by host: desktop keeps keys in
  the OS keychain; web stores them server-side and proxies provider calls.
  The provider UI must not assume one storage model.
- Vite output is currently `app/out/renderer` for Electron. If the same output
  is served by `web/server`, the PWA manifest and icons can stay in the shared
  build; they are harmless in Electron.
- Window controls and drag regions are desktop-only and must not appear in the
  web shell.
