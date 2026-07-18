#!/usr/bin/env bash
# Refuse to publish a macOS bundle that accidentally contains a runtime
# SQLite database. User data belongs in Application Support, never in the app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
APP="$BUNDLE_DIR/macos/TanWords.app"
DMG_DIR="$BUNDLE_DIR/dmg"

[[ -d "$APP" ]] || { echo "Missing app bundle: $APP" >&2; exit 1; }

find_databases() {
  find "$1" -type f \( \
    -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' \
    -o -iname '*-wal' -o -iname '*-shm' \
  \) -print
}

FOUND="$(find_databases "$APP")"
if [[ -n "$FOUND" ]]; then
  echo "Release blocked: database files were found inside TanWords.app:" >&2
  echo "$FOUND" >&2
  exit 1
fi

DMG="$(find "$DMG_DIR" -maxdepth 1 -type f -name 'TanWords_*_universal.dmg' -print | sort | tail -1)"
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
