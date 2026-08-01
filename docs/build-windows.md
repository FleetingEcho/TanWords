# Building and releasing the Windows app

How to produce the Windows installer, and what needs to be on the machine to
do it. Describes the Electron build (electron-builder + electron-updater).

> This document was rewritten alongside the Electron migration. The previous
> version documented the Tauri flow (`bunx tauri build`, NSIS bundles under
> `src-tauri/target/...`, a Tauri-signed `latest.json` manifest). None of that
> exists any more.

---

## 1. Quick reference

From `app/`:

```powershell
cd app
bun run package:win
# or via the helper, which also wires up LIBCLANG_PATH from scoop:
pwsh -NoProfile -File scripts/build-windows.ps1
```

`package:win` runs `core:build` (Rust sidecar, release), `typecheck` + Vite
bundle, then `electron-builder --win`.

Outputs land in the repo-level `dist-releases/` (see
`electron-builder.yml → directories.output`):

| File | Notes |
|---|---|
| `TanWords-Setup-<ver>.exe` (NSIS) | the installer |
| `latest.yml` + matching `.blockmap` | electron-updater feed metadata — upload both together with the exe |

There is no portable-zip target any more; the old `-Portable` script mode now
just warns and builds the installer.

---

## 2. Prerequisites

| Requirement | Why | Install |
|---|---|---|
| Rust, MSVC toolchain | the sidecar | `rustup default stable-x86_64-pc-windows-msvc` |
| `bun` | dependency + build runner | scoop / official installer |
| **LLVM** | `libclang.dll` for bindgen-based crates (sherpa-onnx) | `scoop install llvm` |
| NSIS | installer bundling | electron-builder downloads it on first use |

The helper script resolves LLVM via `scoop prefix llvm` and sets
`LIBCLANG_PATH` itself; if you installed LLVM another way, set `LIBCLANG_PATH`
manually before running `bun run package:win`.

---

## 3. Signing and the updater

Windows updates go through **electron-updater**, not the old Tauri/minisign
flow:

- electron-builder embeds the `publish` config from `electron-builder.yml`
  (GitHub provider → `FleetingEcho/TanWords`) into the app.
- `latest.yml` is the manifest electron-updater downloads. Upload it and the
  `.blockmap` next to the exe on the GitHub release.
- No ed25519/minisign key dance exists on Windows — that scheme
  (`scripts/sign-release.mjs` → `update.json`) is **macOS only**, because the
  ad-hoc-signed mac builds can't use electron-updater's native Squirrel.Mac.

## 4. Releasing

1. Bump `version` in `app/package.json` (electron-builder reads it from there).
2. Build per platform (`bun run package:win` / `:mac` / `:linux`).
3. Create/update the GitHub release and upload each platform's artifacts
   *with* their updater metadata (`latest.yml` on Windows, `latest-linux.yml`
   on Linux).
4. macOS additionally needs its `update.json` regenerated with
   `node app/scripts/sign-release.mjs` and re-uploaded (see the Releases docs
   and `app/electron/main/macUpdater.ts` for the format).
5. Optional but recommended on macOS: `bash app/scripts/verify-release-data.sh`
   to prove no local SQLite database leaked into the bundle.

Publishing to an existing tag replaces assets in place but does **not** prompt
users who already installed that version — bump the version when a fix must
reach existing installs.

---

## 5. Troubleshooting

| Symptom | Cause |
|---|---|
| `LLVM is not installed. Run: scoop install llvm` | `scoop prefix llvm` returned nothing and `LIBCLANG_PATH` unset |
| `libclang.dll was not found at: …` | scoop's llvm exists but is incomplete — reinstall |
| cargo build fails on sherpa-rs-sys on a clean machine | libclang missing; see above |
| App updates never arrive | `latest.yml`/`.blockmap` not uploaded next to the installer |
| `cargo test --lib` does not run on Windows (`STATUS_ENTRYPOINT_NOT_FOUND`) | pre-existing sherpa-rs/onnxruntime DLL issue, see [audio-player.md](audio-player.md); release builds are unaffected |
