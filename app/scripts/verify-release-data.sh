#!/usr/bin/env bash
# Refuse to publish a macOS bundle that accidentally contains a runtime
# SQLite database. User data belongs in Application Support, never in the app.
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

find_databases() {
  find "$1" -type f \( \
    -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' \
    -o -iname '*-wal' -o -iname '*-shm' \
  \) -print
}

FOUND="$(find_databases "$APP")"
if [[ -n "$FOUND" ]]; then
  echo "Release blocked: database files were found inside $APP:" >&2
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
  FOUND="$(find_databases "$MOUNT")"
  if [[ -n "$FOUND" ]]; then
    echo "Release blocked: database files were found inside the DMG:" >&2
    echo "$FOUND" >&2
    exit 1
  fi
  cleanup
  trap - EXIT
fi

echo "Release data check passed: no SQLite database is bundled."
