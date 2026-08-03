#!/usr/bin/env bash
# Refuse to publish a macOS bundle that accidentally carries any of the
# developer's own state. User data belongs in Application Support, never in
# the app.
#
# Databases were the original concern, but they are not the worst case:
# app_config.json holds the app-lock verifier, so shipping one would hand every
# new user a password prompt only the developer can answer. Secrets and .env
# files are here for the obvious reason.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# electron-builder outputs to the repo-level dist-releases/ (see
# app/electron-builder.yml → directories.output), NOT the old
# src-tauri/target/... path this script used before the Electron migration.
BUNDLE_DIR="$ROOT/../dist-releases"

APP="$(find "$BUNDLE_DIR" -maxdepth 2 -type d -name 'TanWords.app' -print 2>/dev/null | sort | tail -1)"
if [[ -z "$APP" ]]; then
  # Fall back to any *.app the platform target produced (e.g. mac--x64 dirs).
  APP="$(find "$BUNDLE_DIR" -maxdepth 3 -type d -name '*.app' -print 2>/dev/null | sort | tail -1)"
fi
[[ -n "$APP" ]] || { echo "No .app bundle found under $BUNDLE_DIR — run bun run package:mac first." >&2; exit 1; }
DMG_DIR="$BUNDLE_DIR"

find_user_state() {
  find "$1" -type f \( \
    -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' \
    -o -iname '*-wal' -o -iname '*-shm' \
    -o -iname 'app_config.json' \
    -o -iname '*secret*' -o -iname '*.key' -o -iname '*.pem' \
    -o -iname '.env' -o -iname '.env.*' \
  \) -print
}

FOUND="$(find_user_state "$APP")"
if [[ -n "$FOUND" ]]; then
  echo "Release blocked: developer state was found inside $APP:" >&2
  echo "$FOUND" >&2
  exit 1
fi

DMG="$(find "$DMG_DIR" -maxdepth 1 -type f -name 'TanWords-*.dmg' -print | sort | tail -1)"
if [[ -n "$DMG" ]]; then
  MOUNT="$(mktemp -d)"
  cleanup() {
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    rmdir "$MOUNT" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$MOUNT" >/dev/null
  FOUND="$(find_user_state "$MOUNT")"
  if [[ -n "$FOUND" ]]; then
    echo "Release blocked: developer state was found inside the DMG:" >&2
    echo "$FOUND" >&2
    exit 1
  fi
  cleanup
  trap - EXIT
fi

# The .app tree hides the renderer inside app.asar, which `find` cannot see
# into — check the archive listing separately or the whole scan has a blind
# spot exactly where bundled files end up.
ASAR="$APP/Contents/Resources/app.asar"
if [[ -f "$ASAR" ]]; then
  if ! command -v npx >/dev/null 2>&1; then
    echo "Release blocked: npx unavailable, cannot inspect app.asar." >&2
    exit 1
  fi
  FOUND="$(npx --yes @electron/asar list "$ASAR" 2>/dev/null | grep -iE \
    '\.(db|sqlite|sqlite3|key|pem)$|-wal$|-shm$|app_config\.json$|secret|(^|/)\.env' || true)"
  if [[ -n "$FOUND" ]]; then
    echo "Release blocked: developer state was found inside app.asar:" >&2
    echo "$FOUND" >&2
    exit 1
  fi
fi

echo "Release data check passed: no database, config or secret is bundled."
