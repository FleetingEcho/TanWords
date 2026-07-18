#!/usr/bin/env bash
# Release TanWords: build signed updater artifacts, generate latest.json,
# and publish everything to a GitHub release.
#
# Usage:
#   ./scripts/release.sh [--notes "release notes"] [--linux-dir <dir>]
#
# Prereqs:
#   - Version bumped (and matching) in app/package.json,
#     app/src-tauri/tauri.conf.json, app/src-tauri/Cargo.toml
#   - Signing key at ~/.tauri/tanwords.key (or TAURI_SIGNING_PRIVATE_KEY[_PATH] set)
#   - `gh` authenticated
#   - Linux artifacts (optional): AppImage + .AppImage.sig built on a Linux
#     box with the same signing key, dropped into --linux-dir (default:
#     dist-releases/). deb/rpm there are uploaded too but don't auto-update.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
GH_REPO="FleetingEcho/TanWords"
LINUX_DIR="$REPO_ROOT/dist-releases"
NOTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES="$2"; shift 2 ;;
    --linux-dir) LINUX_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Version consistency ────────────────────────────────────────────────────
PKG_VERSION=$(node -p "require('$APP_DIR/package.json').version")
CONF_VERSION=$(node -p "require('$APP_DIR/src-tauri/tauri.conf.json').version")
CARGO_VERSION=$(grep -m1 '^version' "$APP_DIR/src-tauri/Cargo.toml" | sed 's/.*"\(.*\)"/\1/')

if [[ "$PKG_VERSION" != "$CONF_VERSION" || "$PKG_VERSION" != "$CARGO_VERSION" ]]; then
  echo "Version mismatch: package.json=$PKG_VERSION tauri.conf.json=$CONF_VERSION Cargo.toml=$CARGO_VERSION" >&2
  exit 1
fi
VERSION="$PKG_VERSION"
TAG="v$VERSION"
echo "==> Releasing $TAG"

if gh release view "$TAG" -R "$GH_REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists on GitHub" >&2
  exit 1
fi

# ── Signing key ────────────────────────────────────────────────────────────
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/tanwords.key"
fi
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-}"
if [[ -n "$KEY_PATH" && ! -f "$KEY_PATH" ]]; then
  echo "Signing key not found at $KEY_PATH" >&2
  exit 1
fi

# ── Build macOS (universal: app for the updater, dmg for first installs) ───
echo "==> Building macOS universal"
(cd "$APP_DIR" && npm run tauri build -- --target universal-apple-darwin --bundles app,dmg)

MAC_BUNDLE_DIR="$APP_DIR/src-tauri/target/universal-apple-darwin/release/bundle"
MAC_TARBALL="$MAC_BUNDLE_DIR/macos/TanWords.app.tar.gz"
MAC_SIG="$MAC_TARBALL.sig"
MAC_DMG="$MAC_BUNDLE_DIR/dmg/TanWords_${VERSION}_universal.dmg"

for f in "$MAC_TARBALL" "$MAC_SIG" "$MAC_DMG"; do
  [[ -f "$f" ]] || { echo "Expected build artifact missing: $f" >&2; exit 1; }
done

# ── Collect Linux artifacts (optional) ─────────────────────────────────────
APPIMAGE=$(ls "$LINUX_DIR"/TanWords_${VERSION}_amd64.AppImage 2>/dev/null || true)
APPIMAGE_SIG=$(ls "$LINUX_DIR"/TanWords_${VERSION}_amd64.AppImage.sig 2>/dev/null || true)
LINUX_EXTRA=$(ls "$LINUX_DIR"/TanWords*${VERSION}*.{deb,rpm} 2>/dev/null || true)

if [[ -z "$APPIMAGE" || -z "$APPIMAGE_SIG" ]]; then
  echo "!! No signed AppImage for $VERSION in $LINUX_DIR — Linux auto-update will be skipped this release"
fi

# ── latest.json ────────────────────────────────────────────────────────────
DL_BASE="https://github.com/$GH_REPO/releases/download/$TAG"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# The updater requests its machine's arch key, so the universal build is
# listed under both darwin keys.
NOTES="$NOTES" VERSION="$VERSION" DL_BASE="$DL_BASE" \
MAC_SIG_CONTENT="$(cat "$MAC_SIG")" \
APPIMAGE_NAME="$(basename "${APPIMAGE:-}")" \
APPIMAGE_SIG_CONTENT="$( [[ -n "$APPIMAGE_SIG" ]] && cat "$APPIMAGE_SIG" || true )" \
node -e '
const platforms = {
  "darwin-aarch64": { signature: process.env.MAC_SIG_CONTENT, url: `${process.env.DL_BASE}/TanWords.app.tar.gz` },
  "darwin-x86_64":  { signature: process.env.MAC_SIG_CONTENT, url: `${process.env.DL_BASE}/TanWords.app.tar.gz` },
};
if (process.env.APPIMAGE_SIG_CONTENT) {
  platforms["linux-x86_64"] = {
    signature: process.env.APPIMAGE_SIG_CONTENT,
    url: `${process.env.DL_BASE}/${process.env.APPIMAGE_NAME}`,
  };
}
process.stdout.write(JSON.stringify({
  version: process.env.VERSION,
  notes: process.env.NOTES || "",
  pub_date: new Date().toISOString(),
  platforms,
}, null, 2));
' > "$STAGE/latest.json"

echo "==> latest.json:"
cat "$STAGE/latest.json"

# ── Publish ────────────────────────────────────────────────────────────────
echo "==> Creating GitHub release $TAG"
ASSETS=("$MAC_DMG" "$MAC_TARBALL" "$MAC_SIG" "$STAGE/latest.json")
[[ -n "$APPIMAGE" ]] && ASSETS+=("$APPIMAGE" "$APPIMAGE_SIG")
[[ -n "$LINUX_EXTRA" ]] && while IFS= read -r f; do ASSETS+=("$f"); done <<< "$LINUX_EXTRA"

gh release create "$TAG" -R "$GH_REPO" --title "TanWords $TAG" \
  --notes "${NOTES:-TanWords $TAG}" "${ASSETS[@]}"

echo "==> Done: https://github.com/$GH_REPO/releases/tag/$TAG"
