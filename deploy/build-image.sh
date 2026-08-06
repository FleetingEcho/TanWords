#!/usr/bin/env bash
set -euo pipefail

# Build the complete Linux/amd64 release image on the developer machine and
# export it for `docker load` on the server. The final image contains only the
# compiled server binary and runtime libraries; build tools remain in discarded
# intermediate stages.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/deploy/tanwords-web-linux-amd64.tar.gz"}
IMAGE=tanwords-web:latest
BUILD_FLAGS=()

if command -v podman >/dev/null 2>&1; then
  ENGINE=podman
  # Fully qualify the tag so a Docker archive loads as `tanwords-web:latest`
  # rather than Podman's local `localhost/tanwords-web:latest` spelling.
  IMAGE=docker.io/library/tanwords-web:latest
  BUILD_FLAGS+=(--format docker --layers)
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
else
  echo "error: install Podman or Docker locally" >&2
  exit 1
fi

echo "==> building $IMAGE for linux/amd64 with $ENGINE"
"$ENGINE" build \
  --platform linux/amd64 \
  "${BUILD_FLAGS[@]}" \
  --tag "$IMAGE" \
  --file "$ROOT/deploy/Dockerfile.build" \
  "$ROOT"

echo "==> exporting $OUT"
mkdir -p "$(dirname "$OUT")"
"$ENGINE" save --format docker-archive "$IMAGE" | gzip -1 > "$OUT"
ls -lh "$OUT"
