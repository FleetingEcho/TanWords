# Building and releasing the Windows app

How to produce the Windows installer and portable zip, what
`app/scripts/build-windows.ps1` does on your behalf and why, and how the result
gets published to a GitHub release so the in-app updater picks it up.

Written and last updated 2026-07-29, against version 0.8.0.

---

## 1. Quick reference

Both commands **must run from `app/`** — they call `bunx tauri`, which resolves
from the nearest `package.json`. From the repo root you get
`error: could not determine executable to run for package tauri`.

```powershell
cd app

bun run build:windows            # NSIS installer + updater signature
bun run build:windows:portable   # standalone exe + DLLs, zipped
```

Or invoke the script directly (identical; the package scripts are thin wrappers):

```powershell
pwsh -NoProfile -File scripts/build-windows.ps1
pwsh -NoProfile -File scripts/build-windows.ps1 -Portable
```

Outputs land under `app/src-tauri/target/release/bundle/`:

| File | From | Notes |
|---|---|---|
| `nsis/TanWords_<ver>_x64-setup.exe` | default run | the installer |
| `nsis/TanWords_<ver>_x64-setup.exe.sig` | default run | updater signature |
| `portable/TanWords_<ver>_windows_x64_portable.zip` | `-Portable` | exe + 4 sherpa DLLs, flat |

A cold build is roughly 2–3 minutes for the installer; the portable pass reuses
the Cargo cache and takes about 1 minute.

---

## 2. Prerequisites

| Requirement | Why | Install |
|---|---|---|
| Rust, MSVC toolchain | the app | `rustup default stable-x86_64-pc-windows-msvc` |
| `bun` | frontend build + `bunx tauri` | scoop / official installer |
| **LLVM** | `libclang.dll` for the bindgen-based crates | `scoop install llvm` |
| NSIS | installer bundling | Tauri downloads it on first use |
| Updater private key | signing `.sig` files | see below |

The script locates LLVM via `scoop prefix llvm` and sets `LIBCLANG_PATH` itself,
so **LLVM must be installed through scoop specifically**. A system LLVM in
`PATH` will not be found and the script throws
`LLVM is not installed. Run: scoop install llvm`. If you install it elsewhere,
set `LIBCLANG_PATH` yourself and the check still passes only if `scoop prefix`
resolves — otherwise patch the script.

### The signing key

Only needed for non-portable builds. Defaults to `~/.tauri/tanwords.key` with an
empty password; the script throws if the file is missing. Override with:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "D:\keys\tanwords.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
```

The signature must verify against `plugins.updater.pubkey` in
`tauri.conf.json` (`RWT4JrvP20at…`). Signing with a different key produces a
release that every existing install rejects.

> **Why the script forwards the variable.** Tauri's signer reads
> `TAURI_SIGNING_PRIVATE_KEY` — path *or* raw key content — not the
> `_PATH`-suffixed name. The script copies one into the other so that setting
> only `..._PATH` works.

---

## 3. What the script does before calling Tauri

Three things, all of them working around problems that only bite on Windows.

### 3.1 Stages the sherpa DLLs into `src-tauri/sherpa-libs/`

`sherpa-rs-sys` (TTS) downloads its shared libraries into a cache under
`%LOCALAPPDATA%\sherpa-rs` and copies them next to Cargo's executable for local
runs. Tauri bundles only what `tauri.conf.json` declares, and it declares
`bundle.resources: { "sherpa-libs/": "" }` — a *fixed relative path*. So the
script copies four DLLs out of the cache into that directory first:

```
onnxruntime.dll
onnxruntime_providers_shared.dll
sherpa-onnx-c-api.dll
sherpa-onnx-cxx-api.dll
```

It searches the cache recursively for each name under a `lib` directory and
**throws if any is missing** (`Sherpa DLL was not found in its cache`). The cure
is a prior `cargo build` / `bun run build:windows` that populates the cache.

This staging is Windows-only script work. `src-tauri/build.rs` does the
equivalent for macOS and Linux, but is `#[cfg]`-gated to those platforms — on
Windows nothing in the Rust build stages anything, so skipping the script and
running `bunx tauri build` by hand yields an installer whose TTS is broken on
any machine that never built the project. Order matters too: `tauri_build::build()`
eagerly validates that `bundle.resources` globs already match at least one file.

`sherpa-libs/` is git-ignored — it is a build artifact, never committed.

### 3.2 Deletes the sherpa DLLs from `target/release/`

`sherpa-rs-sys` creates *hard links* from its cache into Cargo's output folders.
On a second release build it tries to copy the cache file over what is now the
same file, and Windows rejects that. The script removes only those four
generated names, recursively, before rebuilding.

### 3.3 Sets `VITE_PORTABLE`

Set to `"true"` for `-Portable`, explicitly cleared otherwise. It is read at
frontend build time by `components/Layout/UpdateButton.tsx`
(`import.meta.env.VITE_PORTABLE`), so it is **baked into the JS bundle**, not
read at runtime. Portable builds still check for updates but send users to the
release download page instead of invoking the installer-based updater, which
has nothing to install over.

Because it is a compile-time constant, the two builds cannot share a frontend
bundle — that is why `-Portable` recompiles rather than repackaging.

---

## 4. The two build modes

| | default | `-Portable` |
|---|---|---|
| Tauri invocation | `tauri build --bundles nsis` | `tauri build --no-bundle` |
| Signed | yes, `.sig` emitted | no |
| In-app updater | installs the update | links to the releases page |
| Packaging | NSIS | `Compress-Archive` of exe + 4 DLLs |

The portable zip is assembled by the script, not by Tauri: `--no-bundle` stops
after producing `target/release/tanwords.exe`, and the script zips it flat
together with the staged DLLs. The DLLs must sit beside the exe for TTS to work.

> ⚠️ **The portable archive name is hardcoded** in the script
> (`TanWords_0.8.0_windows_x64_portable.zip`, near the end). It does **not** read
> the version from `package.json` or `tauri.conf.json` like the NSIS output does.
> Bumping the app version means editing that string too, or you ship a zip
> labelled with the previous version.

---

## 5. Releasing

Version lives in **both** `app/package.json` and `app/src-tauri/tauri.conf.json`,
plus the hardcoded zip name above. All three must agree.

Upload the three artifacts to the GitHub release, then update `latest.json`:

```powershell
$b = "app\src-tauri\target\release\bundle"
gh release upload v0.8.0 `
  "$b\nsis\TanWords_0.8.0_x64-setup.exe" `
  "$b\nsis\TanWords_0.8.0_x64-setup.exe.sig" `
  "$b\portable\TanWords_0.8.0_windows_x64_portable.zip" `
  --clobber --repo FleetingEcho/TanWords
```

### `latest.json` is the updater manifest

The updater endpoint is
`https://github.com/FleetingEcho/TanWords/releases/latest/download/latest.json`,
and it is a **single file shared by all platforms** — one `platforms` map with
`linux-x86_64`, `darwin-aarch64`, `darwin-x86_64` and `windows-x86_64` entries,
each holding a base64 signature and an asset URL.

So a Windows-only rebuild still has to patch the shared manifest: download the
current `latest.json`, replace `platforms["windows-x86_64"].signature` with the
contents of the new `.exe.sig`, and re-upload with `--clobber`. Leave the other
platforms' entries alone.

**Rebuilding the exe invalidates the old signature.** If you upload a new
installer without updating `latest.json`, every client that tries to update
fails signature verification rather than falling back — this is the easiest way
to break the release.

Sanity-check what actually went out:

```bash
curl -sL https://github.com/FleetingEcho/TanWords/releases/latest/download/latest.json \
  | python -c "import json,sys,base64; d=json.load(sys.stdin); \
      print(base64.b64decode(d['platforms']['windows-x86_64']['signature']).decode())"
```

The decoded `trusted comment` line names the file and a build timestamp — if
that timestamp predates your build, the manifest is stale.

### Publishing to an existing tag

Uploading with `--clobber` to a tag that already has assets replaces them in
place. Users who already installed that version get **no update prompt**, since
the version number did not change — they keep running the old binary. Fine for
correcting a build that few people have; use a version bump when the fix needs
to reach existing installs.

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| `could not determine executable to run for package tauri` | run from `app/`, not the repo root |
| `LLVM is not installed. Run: scoop install llvm` | `scoop prefix llvm` returned nothing |
| `libclang.dll was not found at: …` | scoop's llvm exists but is incomplete — reinstall |
| `Sherpa DLL was not found in its cache: …` | `%LOCALAPPDATA%\sherpa-rs` unpopulated; build once first |
| `Tauri signing private key was not found at: …` | missing `~/.tauri/tanwords.key`, or set the env var |
| Access-denied copying a sherpa DLL | stale hard links in `target/release/` — §3.2 handles this; if it recurs, delete them manually |
| TTS fails only on a *clean* machine | DLLs were not staged; the installer was built without the script |
| Client update fails signature verification | `latest.json` still carries the previous build's Windows signature |

### `cargo test --lib` does not run on Windows

It fails with `STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`) from the
sherpa-rs / onnxruntime DLLs, before any test executes. This is a pre-existing
fault unrelated to any particular feature work — see
[the audio player doc](audio-player.md) §11. It does not affect
`tauri build`, which is why release builds succeed on a machine where the test
binary will not start.
