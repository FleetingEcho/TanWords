# Electron migration — implementation handoff

Read this file and `electron-migration-plan.md`. **You do not need to read the
React UI.** ~38k lines under `src/components`, `src/hooks`, `src/store`,
`src/providers` stay byte-for-byte identical. If you are editing one of those to
make Electron work, you are in the wrong file — the fix belongs in
`src/bridge/*`. Only two UI files change, both listed in Task 6.

## Use bun, never npm or node

```bash
bun install                # never `npm install`
bun add -d electron        # never `npm i`
bun run dev                # never `npm run dev`
bunx vitest run            # never `npx`
```

There is a `bun.lock`; `package-lock.json` has been deleted. Do not recreate it.
Bun is the package manager and script runner. (The Electron *runtime* is still
Chromium+Node — that is unrelated and not something you choose.)

## What is already done — do not redo it

| Done | Where |
| --- | --- |
| `app/src-tauri` renamed to `app/core` | 176 tracked renames, branch `electron-migration` |
| Tauri deps removed from `package.json`, Electron deps added, scripts rewritten for bun | `app/package.json` |
| Vite aliases mapping all 10 `@tauri-apps/*` specifiers onto the bridge | `app/vite.config.ts` |
| All 10 bridge modules written | `app/src/bridge/*.ts` |
| Test setup stubs the preload global | `app/src/test/setup.ts` |
| **Dispatch table generator + all 148 sidecar commands generated** | `app/core/scripts/gen_dispatch.py` -> `app/core/src/rpc/dispatch.rs` |
| Tauri compatibility shim (`State`, `AppHandle`, `emit`, `try_state`) | `app/core/src/shim/mod.rs` |
| Marker `#[command]` proc-macro | `app/core/macros/` |
| RPC arg handling incl. the camelCase->snake_case conversion | `app/core/src/rpc/mod.rs` |

Verified working right now: `bunx vitest run` -> **37 files, 138 tests, 0 errors**
with the bridge aliases active. Keep it that way; it is your regression check
that the UI is genuinely untouched.

## The rule that saves you from reading 50 Rust files

The Rust command bodies **do not change**. `src/shim/mod.rs` provides
Tauri-shaped `State<'_, T>`, `AppHandle`, `.emit()` and `.try_state::<T>()`, so
every existing signature still compiles. Migrating a file is a find/replace:

```bash
cd app/core
rg -l 'tauri::' src/ | xargs sed -i \
  -e 's/#\[tauri::command\]/#[crate::shim::command]/' \
  -e 's/#\[tauri::command(async)\]/#[crate::shim::command(async)]/' \
  -e 's/\btauri::State\b/crate::shim::State/g' \
  -e 's/\btauri::AppHandle\b/crate::shim::AppHandle/g' \
  -e 's/\btauri::Manager\b/crate::shim::Manager/g' \
  -e 's/\btauri::Emitter\b/crate::shim::Emitter/g'
cargo check 2>&1 | head -40
```

Then work the `cargo check` list top-down. **Never delete a `#[..::command]`
attribute** — `gen_dispatch.py` finds commands by scanning for them.

Two things the sed cannot do, and they are the only real thinking in the Rust:

1. `tts_download_model<R: tauri::Runtime>` — drop the generic parameter, the
   shim's `AppHandle` is not generic.
2. Anything under `browser_panel/` and `tray.rs` — **delete both modules**. They
   are reimplemented in Electron main (Task 4). `gen_dispatch.py` already
   excludes their 14 commands via `SKIP_MODULES`.

## Tasks, in order. Each ends with something runnable.

### Task 0 — bridging Tauri release (do first, or user data is lost)
Read plan §7.2. On `main`, not this branch: copy the localStorage keys
(`layoutStore`, `toolsBallStore`, `settingsStore`, and **`tanwords_secret_*`
from `lib/secrets.ts` — those are API keys**) into the SQLite settings table via
the existing `db/settings.rs` commands. Ship it. Electron reads them back on
first run. Once the Electron build ships, this opportunity is gone forever.

### Task 1 — make the Rust crate build standalone
- Run the sed above; delete `browser_panel/` and `tray.rs`.
- `Cargo.toml`: drop `tauri`, `tauri-build`, all 7 `tauri-plugin-*`; add
  `tanwords-macros = { path = "macros" }`, `axum`, `tower-http` (for Range
  requests on `/asset`). Replace `[lib] crate-type` with
  `[[bin]] name = "tanwords-core"`.
- `build.rs`: delete `tauri_build::build()`, keep `stage_sherpa_libs()`.
- `lib.rs`: replace the `tauri::Builder` chain with: open the DB, build a
  `shim::Registry` with the four managed states (`AppState`,
  `McpController`, `NativeAudioState`, plus whatever `browser_panel` used —
  drop that one), build the axum router, bind `127.0.0.1:0`, print
  `{"port":N,"token":"..."}` to stdout, serve.
- Delete `capabilities/`, `gen/`, `tauri*.conf.json` — but first copy the CSP
  and the icon paths out of `tauri.conf.json`, Task 5 needs them.
- Verify: `cargo check` clean, `cargo test` passes, and
  `python3 scripts/gen_dispatch.py` still reports 148 commands / 0 unparsed.

### Task 2 — restore the guarantees that vanish silently
Plan §8.1 and §8.2. These compile fine and are wrong at runtime:
- `native_audio_load` relied on Tauri's main thread for atomicity against the
  other session commands. Axum has no main thread. Put all `native_audio_*`
  behind one mutex or a single-owner actor task.
- Every `#[command(async)]` meant "blocking pool". The generator already emits
  `spawn_blocking` for those — confirm each one compiles and none of them also
  need `State` (none did at generation time).

### Task 3 — Electron main + preload
`electron/main/index.ts`, `electron/preload/index.ts` (dirs exist, empty).
- Sidecar supervisor: spawn `core/target/release/tanwords-core`, parse the
  stdout handshake, expose it to the renderer as `window.tanwords.backend`.
  Watch for exit and restart. Kill on quit — **await** graceful shutdown, do
  not SIGKILL (plan §8.7, Turso sync). Windows: use a Job Object so an orphan
  cannot keep the MCP port bound (§8.6).
- Preload: `contextBridge.exposeInMainWorld("tanwords", { backend, call, on })`.
  `contextIsolation: true`, `nodeIntegration: false`.
- Implement the main-side channels the bridge modules already call. Grep for
  `tanwords?.call("` in `src/bridge/` — that is the complete list, you do not
  need to search anywhere else.
- Serve the renderer from a custom `app://` scheme, **not `file://`** (plan
  §9.1 — `file://` has an opaque origin, so localStorage silently does nothing).
- Verify: app boots, `db_get_word_count` returns a number.

### Task 4 — browser panel and tray in Node
- Browser panel: `WebContentsView` per tab. Keep the **exact** command names,
  argument names and event names (`browser://navigated`, `browser://title-changed`,
  `browser://loading`) — then `useBrowserPanel.ts` needs zero edits.
  Each view: `sandbox: true`, no preload, dedicated session partition (plan §9.2
  — these load arbitrary untrusted websites).
  `viewportOffsetY()` must come out as **0**; `src/bridge/window.ts` is already
  written to make that happen. Do not change it to report device pixels.
- Tray: port `tray.rs` including close-hides-to-tray, the `quitting` flag, and
  the i18n menu (locale must be pushed from renderer to main — §9.4).

### Task 5 — packaging
`electron-builder`, `extraResources`: the `tanwords-core` binary per arch plus
`core/sherpa-libs/`. Carry over the gstreamer `deb`/`rpm` depends from the old
`tauri.conf.json`. macOS: sign the sidecar and list it in the hardened-runtime
entitlements, then **verify saved API keys still resolve** — the keychain ACL is
per-signing-identity (plan §6).

### Task 6 — the only two UI files you may edit
- `src/lib/localAudioSrc.ts`: make `toPlayableSrc` a pass-through. Its blob
  workaround is for WebKitGTK and would break podcast seeking on Chromium
  (plan §8.3).
- `src/lib/localDocs.ts:155`: replace the `http://asset.localhost/` parsing with
  `isAssetUrl` / `assetUrlToPath` from `@/bridge/core`.

After each task: `bunx vitest run` must stay at 138 passing.

## Things that will bite you if you skip the plan

- The camelCase->snake_case arg conversion is already implemented in
  `rpc/mod.rs` and unit-tested. If you rewrite that layer, keep it — the
  frontend sends `{ tabId }`, Rust expects `tab_id`, and ~half the commands
  break without it in a way whose error message points nowhere useful.
- Data paths use the `dirs` crate, not Tauri's path API. The database and the
  downloaded ONNX models stay exactly where they are. **Do not** "clean this up"
  into `app.getPath('userData')` — you would orphan every existing user's
  vocabulary and force a multi-GB model re-download.
- `MAIN_PROCESS_COMMANDS` in `src/bridge/core.ts` and `SKIP_MODULES` in
  `core/scripts/gen_dispatch.py` describe the same split. A name in one and not
  the other is a silent routing bug.
