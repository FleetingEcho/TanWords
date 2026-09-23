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
DMG_DIR="$BUNDLE_DIR"

VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/package.json', 'utf8')).version")"

# Every .app the packaging run produced, not just the first one found. The
# product was renamed TanWords → TanNotes in 2026-09; a hardcoded bundle name
# matched a STALE bundle left in dist-releases/ by an older release and checked
# that instead of the one just built — the worst possible failure mode for a
# gate whose entire job is to look at the artifact you are about to publish.
APPS="$(find "$BUNDLE_DIR" -maxdepth 3 -type d -name '*.app' -print 2>/dev/null | sort)"
if [[ -z "$APPS" ]]; then
  echo "No .app bundle found under $BUNDLE_DIR — run bun run package:mac first." >&2
  exit 1
fi

find_user_state() {
  find "$1" -type f \( \
    -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' \
    -o -iname '*-wal' -o -iname '*-shm' \
    -o -iname 'app_config.json' \
    -o -iname '*secret*' -o -iname '*.key' -o -iname '*.pem' \
    -o -iname '.env' -o -iname '.env.*' \
  \) -print
}

check_app() {
  local app="$1" found asar
  found="$(find_user_state "$app")"
  if [[ -n "$found" ]]; then
    echo "Release blocked: developer state was found inside $app:" >&2
    echo "$found" >&2
    exit 1
  fi

  # The .app tree hides the renderer inside app.asar, which `find` cannot see
  # into — check the archive listing separately or the whole scan has a blind
  # spot exactly where bundled files end up.
  asar="$app/Contents/Resources/app.asar"
  if [[ -f "$asar" ]]; then
    if ! command -v npx >/dev/null 2>&1; then
      echo "Release blocked: npx unavailable, cannot inspect app.asar." >&2
      exit 1
    fi
    found="$(npx --yes @electron/asar list "$asar" 2>/dev/null | grep -iE \
      '\.(db|sqlite|sqlite3|key|pem)$|-wal$|-shm$|app_config\.json$|secret|(^|/)\.env' || true)"
    if [[ -n "$found" ]]; then
      echo "Release blocked: developer state was found inside app.asar:" >&2
      echo "$found" >&2
      exit 1
    fi
  fi
}

while IFS= read -r app; do
  [[ -n "$app" ]] || continue
  echo "inspecting $(basename "$app")"
  check_app "$app"
done <<< "$APPS"

# Only DMGs for the version being released. Matching 'any .dmg' picked up the
# 2.1.3 build still sitting in dist-releases/, mounted that, and passed — the
# artifact actually being published was never inspected at all.
DMGS="$(find "$DMG_DIR" -maxdepth 1 -type f -name "*-${VERSION}*.dmg" -print | sort)"
if [[ -z "$DMGS" ]]; then
  echo "WARNING: no *-${VERSION}*.dmg found in $DMG_DIR — the DMG payload was NOT inspected." >&2
  find "$DMG_DIR" -maxdepth 1 -type f -name '*.dmg' -print | sort | sed 's/^/  present (not checked): /' >&2
fi

while IFS= read -r dmg; do
  [[ -n "$dmg" ]] || continue
  MOUNT="$(mktemp -d)"
  cleanup() {
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    rmdir "$MOUNT" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  echo "inspecting $(basename "$dmg")"
  hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$MOUNT" >/dev/null
  FOUND="$(find_user_state "$MOUNT")"
  if [[ -n "$FOUND" ]]; then
    echo "Release blocked: developer state was found inside $dmg:" >&2
    echo "$FOUND" >&2
    exit 1
  fi
  cleanup
  trap - EXIT
done <<< "$DMGS"

echo "Release data check passed: no database, config or secret is bundled."
