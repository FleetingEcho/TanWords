# Tauri → Electron migration plan

> **Implementing this? Read `electron-migration-handoff.md` first** — it has the
> task order, the bun commands, and the list of work that is already done. This
> file is the reference it points back into: read it once, end to end, before
> starting Task 1. Sections 7–10 are the ones that prevent real bugs.

Goal: replace Tauri 2 with latest Electron, Vite for dev, electron-builder for
packaging — keeping the existing React UI (~38k LOC) essentially untouched and
keeping the existing Rust (~15k LOC) as a **sidecar process** that does all the
heavy work. Node stays thin: windows, tray, dialogs, the browser panel, and
process lifecycle.

## 1. What we're actually migrating

Current surface, measured:

| Area | Size | Fate |
| --- | --- | --- |
| React frontend (`app/src`) | 38,353 LOC, 48 files import `@tauri-apps/*` | **Unchanged** — absorbed by a bridge + Vite aliases |
| Rust (`app/src-tauri/src`) | 15,167 LOC, 164 `#[tauri::command]` (110 async) | **~95% unchanged**, moves into a sidecar binary |
| `browser_panel/mod.rs` | 12 commands, Tauri *unstable* child-webview API | **Rewritten in Node** (`WebContentsView`) |
| `tray.rs` | 2 commands + menu + 4 emitted events | **Rewritten in Node** (`Tray`/`Menu`) |
| Tauri plugins (dialog, shell, clipboard, http, updater, process, single-instance) | 7 | **Replaced** with Electron equivalents |

Only 14 of the 164 commands (browser panel + tray) actually leave Rust. Everything
else — libsql/SQLite, FSRS, TTS (sherpa-rs/ONNX), native audio (rodio/symphonia/
gstreamer/CoreAudio/PulseAudio), RSS, HN, reader, music scanning, local docs,
document privacy crypto, keyring secrets, the MCP server (axum + rmcp) — stays in
Rust exactly as written.

## 2. Target architecture

```
┌─ Electron main (Node) ──────────────────────────────────────────┐
│  BaseWindow + WebContentsView (UI) + WebContentsView (browser)   │
│  Tray, Menu, dialog, shell.openExternal, clipboard               │
│  electron-updater, single-instance lock                          │
│  net.fetch streaming proxy (CORS-free AI provider calls)         │
│  Sidecar supervisor: spawn / handshake / health / kill           │
└───────────────┬─────────────────────────────────────────────────┘
                │ spawn (stdout handshake: port + token)
                ▼
┌─ tanwords-core (Rust binary) ───────────────────────────────────┐
│  axum on 127.0.0.1:<ephemeral>, bearer-token auth                │
│   POST /invoke/:command   → the 150 surviving commands           │
│   GET  /events            → SSE (tts-download-progress, mcp:*)   │
│   GET  /asset?path=...    → Range-capable file serving           │
│  AppState, libsql, TTS engine, audio worker, MCP server          │
└─────────────────────────────────────────────────────────────────┘
                ▲ direct HTTP/SSE from renderer (fast path)
                │
┌─ Renderer (existing React, untouched) ──────────────────────────┐
│  preload bridge → window/tray/dialog/shell/updater/browser panel │
└─────────────────────────────────────────────────────────────────┘
```

**Why the renderer talks to the sidecar directly** rather than hopping through
main: it avoids double serialization on every one of the 98 `invoke` call sites,
and — more importantly — it gives `<audio src>` and `<img src>` a real URL. That
is the only clean replacement for `convertFileSrc` (used by the music player and
local-doc assets), and it gets HTTP Range support for free, which the audio
element needs for seeking. The token is handed to the renderer through preload;
with `contextIsolation: true` / `nodeIntegration: false` that is the same trust
level as exposing an `invoke` bridge at all.

## 3. The compatibility bridge (this is what keeps the UI unchanged)

Rather than edit 48 files, add `app/src/bridge/*` modules and alias the Tauri
import specifiers to them in `vite.config.ts` and `vitest` config:

```ts
resolve: { alias: {
  "@tauri-apps/api/core":                  "/src/bridge/core.ts",
  "@tauri-apps/api/event":                 "/src/bridge/event.ts",
  "@tauri-apps/api/window":                "/src/bridge/window.ts",
  "@tauri-apps/api/app":                   "/src/bridge/app.ts",
  "@tauri-apps/plugin-dialog":             "/src/bridge/dialog.ts",
  "@tauri-apps/plugin-shell":              "/src/bridge/shell.ts",
  "@tauri-apps/plugin-http":               "/src/bridge/http.ts",
  "@tauri-apps/plugin-clipboard-manager":  "/src/bridge/clipboard.ts",
  "@tauri-apps/plugin-updater":            "/src/bridge/updater.ts",
  "@tauri-apps/plugin-process":            "/src/bridge/process.ts",
}}
```

Each bridge module re-exports the same names with the same signatures:

- `core.invoke(cmd, args)` — routes by command name: `browser_*` and `tray_*` go
  to main over `ipcRenderer.invoke`; everything else is
  `POST /invoke/<cmd>` on the sidecar.
- `core.convertFileSrc(path)` → `http://127.0.0.1:<port>/asset?path=<enc>&t=<token>`.
  `lib/localDocs.ts:155` also *parses* `http://asset.localhost/` back into a path —
  that reverse mapping needs the matching update (one of the few real UI edits).
- `event.listen(name, cb)` — one merged emitter over the sidecar SSE stream plus
  main-process events forwarded through preload. `emit` goes to both.
- `dialog`/`shell`/`clipboard`/`process` — thin `ipcRenderer.invoke` wrappers.
- `http.fetch` — main-process `net.fetch` proxy. **This one needs real work**: the
  AI providers stream SSE token-by-token (`providers/openai.ts`,
  `providers/anthropic.ts`, `thinkTagFilter`), so the bridge must return a
  `Response` whose `body` is a live `ReadableStream`. Plan on a `MessagePort`
  (or `ipcRenderer.on` chunk protocol) rather than a request/response IPC call.
- `updater.check` / `process.relaunch` — mapped onto `electron-updater`, shaped to
  the `Update` object `store/updaterStore.ts` expects.

Net effect: `store/updaterStore.test.ts`, `LocalDocsView.test.tsx` and friends keep
mocking the same specifiers and keep passing.

### One subtle correctness trap

Tauri silently converts camelCase JS argument keys to snake_case Rust parameters —
the frontend sends `{ tabId }` into `fn browser_navigate(tab_id: String)`. The
axum `/invoke` layer **must replicate that conversion** on the request body, or
~half the commands break with confusing "missing field" errors.

Return values are safe: the 74 `Serialize` structs already carry explicit
`#[serde(rename_all = ...)]` attributes (23 of them), so responses are
byte-identical to today.

## 4. Rust sidecar changes

Mechanical, and small relative to the crate:

1. `Cargo.toml`: drop `tauri`, `tauri-build`, and the 7 `tauri-plugin-*` deps;
   drop `build.rs`'s `tauri_build::build()` (keep `stage_sherpa_libs()`).
   Change `crate-type` to a plain `[[bin]] name = "tanwords-core"`.
2. Replace the Tauri DI types with equivalents carried in axum state:
   - `State<'_, AppState>` → `axum::extract::State<Arc<AppState>>`
   - `AppHandle` → an `EventBus` handle (a `tokio::broadcast` sender feeding SSE)
   - `app.emit(name, payload)` → `bus.emit(name, payload)` — only 11 call sites
     (`tts/download.rs`, `mcp/controller.rs`, plus browser/tray which leave).
   - `app.try_state::<T>()` → fields on the shared state struct.
3. `#[tauri::command]` → a small `command!` registration macro (or a generated
   match arm per command) mapping name → handler. 150 entries, generated from the
   existing `generate_handler!` list.
4. Delete `browser_panel/` and `tray.rs`; the MCP server, keyring, audio and TTS
   modules compile untouched.
5. Add: handshake (print `{"port":N,"token":"..."}` on stdout, then serve),
   graceful shutdown on stdin EOF / parent death, and a `--single-instance` guard
   is no longer needed (Electron owns that).

`tauri::async_runtime::block_on` / `spawn` become plain `tokio` — the crate
already depends on `tokio` with `rt-multi-thread`.

## 5. Node-side rewrites

**Browser panel** — the good news of this migration. Tauri's child-webview API is
explicitly *unstable* (see the `Cargo.toml` comment) and needed `history.back()`
`eval` hacks for navigation. Electron's `WebContentsView` is the first-class
equivalent: `setBounds`, `setVisible`, real `goBack()`/`goForward()`, `did-navigate`
/ `page-title-updated` / `did-start-loading` events, and `session.clearStorageData()`
for hard reload. Reimplement the 12 `browser_*` commands against it, keeping the
exact same command names, argument names and emitted event names
(`browser://navigated`, `browser://title-changed`, `browser://loading`) — then
`useBrowserPanel.ts` needs **zero changes**.

This does require the main window to be a `BaseWindow` hosting the app UI as its
own `WebContentsView`, so panel views can be layered above it.

Note: `useBrowserPanel` currently offsets bounds by `viewportOffsetY()` to convert
viewport → native content coordinates. Electron `setBounds` is already relative to
the window's content area, so that offset likely becomes 0 — worth verifying
early, it's the classic source of "panel covers the header" bugs.

**Tray** — `tray.rs` → Electron `Tray` + `Menu`. Preserve the i18n menu, the
collapsible music submenu, the `tray-toggle-play` / `tray-prev` / `tray-next` /
`tray-refresh-rss` event names, and `show_main_window`. Also port the
close-hides-to-tray behavior from `on_window_event` and the `quitting` flag.

**Single instance** — `app.requestSingleInstanceLock()` + `second-instance` →
show main window. Same semantics as `tauri-plugin-single-instance`, and it still
protects against a duplicate SQLite connection / duplicate MCP port bind.

## 6. Build & packaging

- Dev: `vite` on 5420 (unchanged) + `electron` main built by `vite` in a second
  config (or `electron-vite`). `cargo build` the sidecar and point the supervisor
  at `target/debug/tanwords-core`.
- Prod: `electron-builder`, with the sidecar and its dylibs as `extraResources`:
  `sherpa-libs/` (currently a Tauri `bundle.resources` entry) plus the
  `tanwords-core` binary per target arch. `process.resourcesPath` at runtime.
- The Linux gstreamer runtime deps (`deb`/`rpm` `depends`) carry over to
  electron-builder's `deb.depends` / `rpm.depends`; AppImage no longer gets
  `bundleMediaFramework`, so verify audio on AppImage explicitly.
- macOS: the sidecar must be signed **and** listed in the app's hardened-runtime
  entitlements, and `keyring`'s Keychain access is identity-scoped — expect a
  fresh Keychain prompt and confirm saved API keys still resolve after signing.
- Windows: `scripts/build-windows.ps1` gets replaced by electron-builder targets.

## 7. User-data continuity — read this before writing any code

### 7.1 The good news: on-disk data is Tauri-independent

Every path in the Rust code goes through the `dirs` crate, **not** Tauri's path
API (`appconfig.rs:27`, `lib.rs:320`/`334`, `tts/models.rs:16`):

```rust
dirs::data_dir().join("tanwords")   // SQLite DB + app_config.json
dirs::cache_dir()                   // downloaded TTS models
```

So the vocabulary database, the connection profile, and the (large) downloaded
ONNX models all stay exactly where they are. No data migration, no re-download.
That is a significant piece of luck — keep it that way by not "tidying" these
into `app.getPath('userData')`.

Same for `keyring::Entry::new("tanwords", key)` — a fixed service name, not a
Tauri identifier. The stored secrets survive; only the macOS signing-identity ACL
changes (see §6).

### 7.2 The bad news: localStorage will be wiped

This is the biggest correctness risk in the migration and it is easy to miss.

Tauri serves the app from `tauri://localhost` (macOS/Linux) or
`http://tauri.localhost` (Windows). Electron will serve from `file://` or a
custom scheme. **localStorage is origin-scoped**, so on upgrade every existing
user silently loses:

| What | Where |
| --- | --- |
| Sidebar collapse state | `store/layoutStore.ts:16` |
| Tools-ball position / size / maximized | `store/toolsBallStore.ts:30-98` |
| Settings store persistence | `store/settingsStore.ts` |
| **API keys**, when the OS keychain is unavailable | `lib/secrets.ts` — `tanwords_secret_*` mirror |
| Legacy pre-keychain key migration flags | `lib/initProviders.ts` |

The `secrets.ts` fallback is the serious one: on unsigned/dev macOS builds (and
any Linux box without a running secret service) that localStorage mirror is the
*only* copy of the user's API keys.

**Recommended fix, and it has to happen before the cutover:** ship one more
Tauri release that copies the relevant localStorage keys into the SQLite settings
table — `db/settings.rs` already exposes 16 commands for exactly this kind of
storage, and it lives in a file that survives. The Electron build then reads them
back out on first run and re-seeds localStorage. Doing it the other way round
(reading WebKit's on-disk localStorage from Electron) means parsing a different
LevelDB/SQLite store per platform — not worth it.

## 8. Semantics that silently change (the subtle ones)

These are places where the code compiles and looks fine but the guarantee it was
relying on has quietly evaporated.

1. **`native_audio_load` loses its atomicity.** Read the comment at
   `native_audio/mod.rs:~148`: it is *deliberately not* `#[tauri::command(async)]`
   because running on Tauri's main thread is what serializes it against the other
   session commands. Between taking the old session and installing the new one,
   `session` is `None`, and a `native_audio_stop` landing in that window is
   dropped — leaving a track playing forever. In axum, **every request is on a
   tokio worker; there is no main thread**. That guarantee is gone the moment the
   file compiles. Restore it explicitly: a single `Mutex`/actor task owning all
   `native_audio_*` commands, or a command channel serviced by one thread.
   `podcastPlayerStore`'s load-serializing chain assumes this too.

2. **`#[tauri::command(async)]` has no direct axum equivalent.** It meant "run on
   the blocking pool." `native_audio_probe_duration` uses it so concurrent
   duration probes are actually concurrent, and `tts_synthesize` already uses
   `spawn_blocking` by hand. Audit every `(async)` variant and map it to
   `tokio::task::spawn_blocking` — otherwise CPU-bound ONNX/GStreamer work will
   starve the axum workers serving the other 150 commands.

3. **`localAudioSrc.ts` becomes actively harmful.** It exists to work around
   WebKitGTK's GStreamer backend having no source element for `asset://`, by
   fetching the whole file and handing `<audio>` a `blob:` URL. Chromium has no
   such gap and the new `/asset` endpoint speaks HTTP with Range support — but
   the blob path loads entire files into memory and **destroys seeking on long
   podcasts**. This is one of the few places the UI genuinely *should* change:
   `toPlayableSrc` should become a pass-through.

4. **`viewportOffsetY()` will be wrong, not absent.** `useBrowserPanel.ts:86`
   computes `innerSize()/scaleFactor() - window.innerHeight` because Tauri panel
   bounds are in physical pixels relative to the whole window. Electron's
   `WebContentsView.setBounds` takes DIPs relative to the content area, so the
   correct value is almost certainly `0`. Have the bridge's `getCurrentWindow()`
   return values that make this compute 0, rather than leaving a plausible-looking
   nonzero offset that puts the panel over the header.

5. **Sidecar death is a new failure mode.** Today a Rust panic takes the whole app
   down visibly. Now the sidecar can die and leave a fully-rendered UI where all
   150 commands fail one by one. The bridge needs a connection state and a visible
   "backend disconnected / restarting" surface, plus supervisor restart.

6. **Orphaned sidecars hold the MCP port.** If Electron crashes, the sidecar keeps
   running and keeps `127.0.0.1:<mcp port>` bound — the exact failure the
   single-instance plugin was there to prevent. Watch stdin for EOF in Rust, and
   on Windows use a Job Object so the child dies with the parent.

7. **Turso sync needs a graceful shutdown.** An embedded-replica profile syncs in
   the background; `replace_db`'s doc notes the sync stops when the old `Db`
   drops. `before-quit` must ask the sidecar to shut down and *await* it, not
   SIGKILL it, or the last writes never reach the user's primary.

8. **Startup ordering inverts.** Tauri blocks on `open_startup_db()` before the
   window exists. Now the renderer can mount before the sidecar has handshaken —
   `invoke` must queue until ready, and `db_fallback_warning` (surfaced once at
   startup) needs somewhere to land after the UI is already up.

## 9. New work the Tauri version never had to do

1. **Serve the renderer from a custom scheme, not `file://`.** Register something
   like `app://` via `protocol.handle`. `file://` breaks absolute asset paths,
   gives you an opaque origin (no localStorage at all), and breaks
   `documentWorkerClient.ts`'s `new Worker(new URL(...), { type: "module" })`.
   Set Vite's `base` accordingly.

2. **Lock down the browser panel — it loads arbitrary untrusted websites.** Tauri's
   child webviews had no Node to leak. In Electron each panel `WebContentsView`
   needs `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, **no
   preload**, a dedicated `session` partition (which is also the clean mapping for
   `browser_hard_reload`'s `clear_all_browsing_data` → `session.clearStorageData()`
   and for "all tabs share one cookie jar"), and a `setWindowOpenHandler` that
   denies popups or routes them into a new tab. Also handle `will-navigate` and
   `permission-request` (geolocation/camera/notifications) explicitly.

3. **An application menu.** Tauri shipped without one; Electron installs a default
   menu with accelerators. Cmd+W must not bypass the close-hides-to-tray behavior,
   and Cmd+Q must set the `quitting` flag that `tray.rs` uses. Build the menu
   explicitly rather than inheriting the default.

4. **Tray i18n needs the locale in the main process.** The recent tray-i18n work
   lives in Rust; in Electron it moves to Node, which has no access to the
   renderer's language state. Push the current locale to main on change and
   rebuild the menu.

5. **Web Speech fallback may regress on Linux.** `ttsBackend.ts` falls back to
   `window.speechSynthesis` when no embedded engine is loaded, and
   `useArticlePlayer`/`SpeakButton` drive it. Chromium on Linux returns an empty
   voice list without `speech-dispatcher` installed. Verify, and consider adding
   it to the `deb`/`rpm` depends alongside the GStreamer packages.

6. **Keep vitest green without rewriting tests.** jsdom has no `EventSource` and
   no reachable sidecar. The bridge modules need a test/no-backend mode so
   `LocalDocsView.test.tsx`, `updaterStore.test.ts` etc. keep passing against the
   same mocked specifiers. `src/test/setup.ts` is currently one line — it will
   need to stub the preload bridge global.

7. **`vite.config.ts` housekeeping.** `TAURI_DEV_HOST`, `server.watch.ignored:
   ["**/src-tauri/**"]`, and `strictPort: true` on 5420 all need updating for the
   renamed Rust directory and the Electron dev flow.

8. **Return TTS audio as bytes, not base64.** `tts/engine.rs:191` base64-encodes
   the WAV because Tauri IPC is JSON. Over HTTP you can return
   `application/octet-stream` and drop ~33% of the payload plus the decode step.
   Optional, but it's a free win while you're touching that boundary — it does
   require editing `ttsBackend.ts`.

## 10. Risks to decide on up front

1. **localStorage wipe (§7.2)** — needs a bridging Tauri release. Highest priority
   because the window to fix it closes once you ship Electron.
2. **Updater break.** Shipped 1.0.0 users check the Tauri `latest.json` with a
   minisign pubkey; `electron-updater` uses a different manifest and signing
   scheme. Users will not auto-migrate. Most likely a final Tauri-side release
   whose notes push a manual download. Pairs naturally with the §7.2 release.
3. **`plugin-http` streaming fetch** is the single highest-effort bridge module.
   Worth prototyping before committing to the whole migration.
4. **CSP.** The current policy allows `asset:`/`asset.localhost`; it becomes
   `connect-src`/`media-src`/`img-src http://127.0.0.1:*`. Note the existing
   `assetProtocol.scope: ["**"]` is wide open — the `/asset` endpoint should keep
   the bearer token *and* is a good opportunity to scope paths properly.

Bundle size (~20 MB → ~200 MB) is a known and accepted consequence.

## 11. Suggested sequencing

Each phase should end with something runnable.

0. **Ship the bridging Tauri release** (§7.2 localStorage → SQLite, plus updater
   notes). This must go out and reach users *before* the Electron build lands.
1. **Spike (highest risk first).** Bare Electron shell + `WebContentsView` browser
   panel + streaming `net.fetch` bridge. Prove both before touching Rust. ~2 days.
2. **Sidecar-ize Rust.** Strip Tauri, add axum `/invoke` + `/events` + `/asset`,
   camelCase→snake_case arg shim, handshake. Keep a `cargo test` pass —
   `localdocs`, `native_audio`, `mcp` have existing tests, and `dev-dependencies`
   currently pulls `tauri` with the `test` feature, which will need replacing.
3. **Bridge modules + Vite aliases.** UI still untouched; `npm run test` green.
4. **Main-process features.** Tray, single-instance, dialogs, shell, clipboard,
   close-to-tray, window state.
5. **Port browser panel + tray commands** to the real implementations, verify the
   `browser://*` event contract.
6. **electron-builder** for Linux/macOS/Windows, sidecar + sherpa-libs resources,
   signing.
7. **Updater migration** and release-channel cutover.
8. **Delete `src-tauri` Tauri scaffolding**: `tauri.conf.json`, `capabilities/`,
   `gen/`, `tauri.{linux,macos}.conf.json`.

Phases 1–3 are where the uncertainty lives; 4–8 are mostly mechanical.
