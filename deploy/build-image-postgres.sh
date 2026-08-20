#!/usr/bin/env bash
set -euo pipefail

# Build the Postgres image (deploy/Dockerfile.postgres) on the developer
# machine and export it for `docker load` on the server, mirroring
# build-image.sh's pattern for the `app` image. No custom compilation here —
# the Dockerfile just layers TLS/pg_hba config onto the official postgres
# image — but it still has to be built for the server's linux/amd64.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/deploy/tanwords-postgres-linux-amd64.tar.gz"}
IMAGE=tanwords-postgres:latest
BUILD_FLAGS=()

if command -v podman >/dev/null 2>&1; then
  ENGINE=podman
  IMAGE=docker.io/library/tanwords-postgres:latest
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
  --file "$ROOT/deploy/Dockerfile.postgres" \
  "$ROOT/deploy"

echo "==> exporting $OUT"
mkdir -p "$(dirname "$OUT")"
"$ENGINE" save --format docker-archive "$IMAGE" | gzip -1 > "$OUT"
ls -lh "$OUT"
