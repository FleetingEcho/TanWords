#!/usr/bin/env bash
set -euo pipefail

# Stands up (or updates) just a self-hosted sqld instance for a TanWords
# desktop app to connect to directly (Settings > Cloud tab) — no web app, no
# accounts, nothing else. Unlike deploy/build-and-deploy.sh there's no image
# to build or upload: sqld is a public prebuilt image pulled straight from
# ghcr.io on the server, so this is just config + a `docker compose pull/up`.

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
DEPLOY_ENV=${TANWORDS_SQLD_DEPLOY_ENV:-"$SCRIPT_DIR/.env"}
REMOTE_DIR=${TANWORDS_SQLD_REMOTE_DIR:-/opt/tanwords-sqld}

usage() {
  echo "Usage: $0 [user@host]"
  echo
  echo "Deploys (or updates) a standalone sqld instance a desktop app can"
  echo "connect to directly. Bootstraps a clean server by itself (Docker,"
  echo "firewall ports, the target directory) the same way"
  echo "deploy/deploy-server.sh does. The target defaults to"
  echo "root@TANWORDS_PUBLIC_HOST from deploy/sqld-only/.env."
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

PUBLIC_HOST=${TANWORDS_PUBLIC_HOST:-}
if [[ -z "$PUBLIC_HOST" && -f "$DEPLOY_ENV" ]]; then
  PUBLIC_HOST=$(awk -F= '$1 == "TANWORDS_PUBLIC_HOST" {sub(/^[^=]*=/, ""); print; exit}' "$DEPLOY_ENV")
fi
if [[ -z "$PUBLIC_HOST" ]]; then
  echo "error: set TANWORDS_PUBLIC_HOST in $DEPLOY_ENV or the environment" >&2
  echo "       (cp deploy/sqld-only/.env.example deploy/sqld-only/.env first)" >&2
  exit 1
fi
if [[ ! "$PUBLIC_HOST" =~ ^[A-Za-z0-9.:-]+$ ]]; then
  echo "error: TANWORDS_PUBLIC_HOST contains unsupported characters" >&2
  exit 1
fi
TARGET=${1:-${TANWORDS_DEPLOY_TARGET:-root@$PUBLIC_HOST}}

touch "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
if [[ -z "$(awk -F= '$1 == "TANWORDS_SQLD_AUTH_KEY" {print $2}' "$DEPLOY_ENV")" ]]; then
  echo "==> generating TANWORDS_SQLD_AUTH_KEY in $DEPLOY_ENV"
  printf 'TANWORDS_SQLD_AUTH_KEY=%s\n' "$(openssl rand -hex 32)" >> "$DEPLOY_ENV"
fi
bun "$SCRIPT_DIR/write-public-key.mjs"

SSH_DIR=$(mktemp -d /tmp/tanwords-sqld-ssh.XXXXXX)
SSH_SOCKET="$SSH_DIR/control"
cleanup() {
  ssh -o ControlPath="$SSH_SOCKET" -O exit "$TARGET" >/dev/null 2>&1 || true
  rm -rf "$SSH_DIR"
}
trap cleanup EXIT
SSH_OPTS=(-o ControlPath="$SSH_SOCKET")

echo "==> connecting to $TARGET"
ssh -o ControlMaster=yes -o ControlPath="$SSH_SOCKET" -o ControlPersist=120 -Nf "$TARGET"

echo "==> uploading configuration"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/compose.yml" "$TARGET:/tmp/tanwords-sqld-compose.yml"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/Caddyfile" "$TARGET:/tmp/tanwords-sqld-Caddyfile"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/jwt.pub" "$TARGET:/tmp/tanwords-sqld-jwt.pub"

ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "$PUBLIC_HOST" "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
public_host_arg=$1
remote_dir=$2

# Bootstrap a genuinely clean server, same as deploy/deploy-server.sh: all of
# this is a no-op if it's already in place, so it costs nothing on a normal
# redeploy either.
mkdir -p "$remote_dir/sqld"
cd "$remote_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker not found, installing via get.docker.com"
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp comment 'TanWords sqld ACME' >/dev/null
  ufw allow 8443/tcp comment 'TanWords sqld' >/dev/null
  ufw allow 8443/udp comment 'TanWords sqld HTTP/3' >/dev/null
fi

touch .env
chmod 600 .env
if [ -z "$(awk -F= '$1 == "TANWORDS_PUBLIC_HOST" {print $2}' .env)" ]; then
  sed -i "/^TANWORDS_PUBLIC_HOST=/d" .env
  printf 'TANWORDS_PUBLIC_HOST=%s\n' "$public_host_arg" >> .env
fi

mv /tmp/tanwords-sqld-compose.yml compose.yml
mv /tmp/tanwords-sqld-Caddyfile Caddyfile
mv /tmp/tanwords-sqld-jwt.pub sqld/jwt.pub

docker compose pull sqld caddy
docker compose up -d
docker compose up -d --no-deps --force-recreate sqld

sleep 2
sqld_status=$(docker inspect --format '{{.State.Status}}' "$(docker compose ps -q sqld)")
if [ "$sqld_status" != "running" ]; then
  docker compose logs --no-color --tail=100 sqld
  echo "error: sqld container is not running (status: $sqld_status)" >&2
  exit 1
fi

public_host=$(awk -F= '$1 == "TANWORDS_PUBLIC_HOST" {sub(/^[^=]*=/, ""); print; exit}' .env)
curl --fail --silent --show-error --max-time 15 "https://$public_host:8443/health" >/dev/null

echo
docker compose ps sqld caddy
echo
echo "Deployment verified: https://$public_host:8443"
REMOTE

echo
echo "sqld connection for a desktop app (Settings > Cloud tab):"
echo "  URL:   https://$PUBLIC_HOST:8443"
echo "  Token: $(bun "$SCRIPT_DIR/sign-token.mjs" 2>/dev/null)"
