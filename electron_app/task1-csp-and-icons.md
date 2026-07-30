Extracted from app/core/tauri.conf.json (and the two platform overrides)
before deleting them in Task 1 of the Electron migration. A later task needs
these — see docs/electron-migration-plan.md §10.4 for the CSP-scoping note.

## CSP (from `app.security.csp`)

```
default-src 'self'; connect-src 'self' https: http:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http: asset: http://asset.localhost; font-src 'self' data:; media-src 'self' https: http: blob: data: asset: http://asset.localhost
```

For Electron this becomes (per the plan): drop `asset:`/`asset.localhost`,
add `connect-src`/`media-src`/`img-src http://127.0.0.1:*` instead (the
sidecar's `/asset` and `/invoke` endpoints). The old `assetProtocol.scope:
["**"]` was wide open — scoping `/asset` to real paths, gated by the bearer
token, is the opportunity called out in plan §10.4.

## App identity

- `productName`: "TanWords"
- `identifier` (bundle id): "com.tanner.tanwords"
- `version`: "1.0.0"

## Window defaults (from `app.windows[0]`)

- title: "TanWords"
- width: 1200, height: 800
- minWidth: 900, minHeight: 600
- resizable: true, fullscreen: false, center: true

## Icons (from `bundle.icon`, paths relative to app/core/)

- `icons/32x32.png`
- `icons/128x128.png`
- `icons/128x128@2x.png`
- `icons/icon.icns`
- `icons/icon.ico`

(The `icons/` directory itself is not deleted by Task 1 — only the
`tauri*.conf.json` files, `capabilities/`, and `gen/` are. The icon files
still live at `app/core/icons/` for Task 5 packaging to pick up.)

## Updater (from `plugins.updater`) — reference only, being replaced

- pubkey: `dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDlGQUQ0NkRCQ0ZCQjI2RjgKUldUNEpydlAyMGF0bjZmV1k1bVJsZXBlaXU1Uy8zVnk0a25hdUZrdWlqVXdKT3hWV21rTzFzcmQK`
- endpoint: `https://github.com/FleetingEcho/TanWords/releases/latest/download/latest.json`

electron-updater uses a different manifest/signing scheme entirely (plan
§10.2) — this is not directly reusable, kept here only so nobody has to dig
it back out of git history.

## Linux packaging (from `bundle.linux`)

- AppImage: `bundleMediaFramework: true` (no electron-builder equivalent —
  verify audio on AppImage explicitly, plan §9.5)
- deb `depends`: `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad`, `gstreamer1.0-plugins-ugly`
- rpm `depends`: `gstreamer1-plugins-good`, `gstreamer1-plugins-bad-free`, `gstreamer1-plugins-ugly-free`

Carry these over to electron-builder's `deb.depends` / `rpm.depends` (plan §6).

## Bundled resources (from `bundle.resources` + the platform overrides)

- `sherpa-libs/` (whole dir on the base config)
- macOS-specific (`tauri.macos.conf.json`): only these three explicitly listed
  (base config bundles the whole directory anyway, this looks like a leftover
  override):
  - `sherpa-libs/libonnxruntime.1.17.1.dylib`
  - `sherpa-libs/libsherpa-onnx-c-api.dylib`
  - `sherpa-libs/libsherpa-onnx-cxx-api.dylib`
- Linux-specific (`tauri.linux.conf.json`): `sherpa-libs/*.so`

For electron-builder, ship `core/sherpa-libs/` as `extraResources` (plan §6).
