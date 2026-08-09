#!/usr/bin/env bash
set -euo pipefail

# One-command production release: build the Linux/amd64 runtime image locally,
# then upload, restart, and verify it with the existing server deployer.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ARCHIVE="$SCRIPT_DIR/tanwords-web-linux-amd64.tar.gz"

usage() {
  echo "Usage: $0 [user@host]"
  echo
  echo "Builds the production image locally, deploys it to the server, and"
  echo "verifies the public HTTPS endpoint. The target defaults to"
  echo "TANWORDS_DEPLOY_TARGET or root@TANWORDS_PUBLIC_HOST."
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  --skip-build)
    echo "error: $0 always builds; use deploy-server.sh --skip-build instead" >&2
    exit 2
    ;;
esac

echo "==> compiling production image"
"$SCRIPT_DIR/build-image.sh" "$ARCHIVE"

echo "==> publishing production image"
"$SCRIPT_DIR/deploy-server.sh" --skip-build "$@"
