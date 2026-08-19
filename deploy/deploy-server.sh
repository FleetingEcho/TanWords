#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_ENV=${TANWORDS_DEPLOY_ENV:-"$ROOT/deploy/.env"}
ARCHIVE="$ROOT/deploy/tanwords-web-linux-amd64.tar.gz"
SKIP_BUILD=0

PUBLIC_HOST=${TANWORDS_PUBLIC_HOST:-}
if [[ -z "$PUBLIC_HOST" && -f "$DEPLOY_ENV" ]]; then
  PUBLIC_HOST=$(awk -F= '$1 == "TANWORDS_PUBLIC_HOST" {sub(/^[^=]*=/, ""); print; exit}' "$DEPLOY_ENV")
fi
if [[ -z "$PUBLIC_HOST" ]]; then
  echo "error: set TANWORDS_PUBLIC_HOST in $DEPLOY_ENV or the environment" >&2
  exit 1
fi
if [[ ! "$PUBLIC_HOST" =~ ^[A-Za-z0-9.:-]+$ ]]; then
  echo "error: TANWORDS_PUBLIC_HOST contains unsupported characters" >&2
  exit 1
fi
TARGET=${TANWORDS_DEPLOY_TARGET:-root@$PUBLIC_HOST}

# Unlike TANWORDS_MASTER_KEY/INVITE_KEY/ADMIN_KEY below (generated server-side,
# since only the server ever needs them), the sqld auth secret must be known
# *locally* too, to sign desktop-client tokens (deploy/sqld/sign-token.mjs).
# So it lives in the local .env, is generated here if missing, and only its
# derived public key (never the secret) is uploaded.
touch "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
if [[ -z "$(awk -F= '$1 == "TANWORDS_SQLD_AUTH_KEY" {print $2}' "$DEPLOY_ENV")" ]]; then
  echo "==> generating TANWORDS_SQLD_AUTH_KEY in $DEPLOY_ENV"
  printf 'TANWORDS_SQLD_AUTH_KEY=%s\n' "$(openssl rand -hex 32)" >> "$DEPLOY_ENV"
fi
bun "$ROOT/deploy/sqld/write-public-key.mjs"

usage() {
  echo "Usage: $0 [--skip-build] [user@host]"
  echo
  echo "Builds the Linux/amd64 runtime image locally, uploads it, replaces only"
  echo "the app container, and verifies the public HTTPS endpoint."
}

while (($#)); do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) TARGET=$1 ;;
  esac
  shift
done

if ((SKIP_BUILD == 0)); then
  "$ROOT/deploy/build-image.sh" "$ARCHIVE"
elif [[ ! -f "$ARCHIVE" ]]; then
  echo "error: $ARCHIVE does not exist; omit --skip-build" >&2
  exit 1
fi

# Open one multiplexed SSH connection so password authentication is requested
# once and reused by both scp and ssh. No credential is stored by this script.
SSH_DIR=$(mktemp -d /tmp/tanwords-ssh.XXXXXX)
SSH_SOCKET="$SSH_DIR/control"
cleanup() {
  ssh -o ControlPath="$SSH_SOCKET" -O exit "$TARGET" >/dev/null 2>&1 || true
  rm -rf "$SSH_DIR"
}
trap cleanup EXIT

SSH_OPTS=(-o ControlPath="$SSH_SOCKET")

echo "==> connecting to $TARGET"
ssh -o ControlMaster=yes -o ControlPath="$SSH_SOCKET" -o ControlPersist=120 -Nf "$TARGET"

echo "==> uploading compiled runtime image"
scp "${SSH_OPTS[@]}" "$ARCHIVE" "$TARGET:/tmp/tanwords-web-linux-amd64.tar.gz"

echo "==> uploading deploy configuration"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/compose.yml" "$TARGET:/tmp/tanwords-compose.yml"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/caddy/Caddyfile" "$TARGET:/tmp/tanwords-Caddyfile"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/sqld/jwt.pub" "$TARGET:/tmp/tanwords-jwt.pub"

echo "==> loading image and replacing app container"
ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "$PUBLIC_HOST" <<'REMOTE'
set -euo pipefail
public_host_arg=$1

# Bootstrap a genuinely clean server: the directory this whole script `cd`s
# into next, Docker itself, and the inbound ports Caddy/sqld need. All of
# this is a no-op on a server that already has them (mkdir -p, "docker
# already installed", "ufw rule already present" are all idempotent), so it
# costs nothing on a routine redeploy.
mkdir -p /opt/tanwords/deploy/caddy
cd /opt/tanwords/deploy

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker not found, installing via get.docker.com"
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp comment 'TanWords HTTP' >/dev/null
  ufw allow 443/tcp comment 'TanWords HTTPS' >/dev/null
  ufw allow 443/udp comment 'TanWords HTTP/3' >/dev/null
  ufw allow 8443/tcp comment 'TanWords sqld' >/dev/null
fi

# Initialize absent configuration values without changing existing keys. Empty
# assignments are treated as absent. Newly generated values are printed only at
# the end, after a successful deployment, so they can be saved immediately.
touch .env
chmod 600 .env

read_env() {
  awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); value=$0} END {print value}' .env
}
set_env() {
  key=$1
  value=$2
  sed -i "/^${key}=/d" .env
  printf '%s=%s\n' "$key" "$value" >> .env
}

if [ -z "$(read_env TANWORDS_PUBLIC_HOST)" ]; then
  set_env TANWORDS_PUBLIC_HOST "$public_host_arg"
fi

generated_master=""
generated_invite=""
generated_admin=""

if [ -z "$(read_env TANWORDS_MASTER_KEY)" ]; then
  generated_master=$(openssl rand -hex 32)
  set_env TANWORDS_MASTER_KEY "$generated_master"
fi
if [ -z "$(read_env TANWORDS_INVITE_KEY)" ]; then
  generated_invite=$(openssl rand -hex 16)
  set_env TANWORDS_INVITE_KEY "$generated_invite"
fi
if [ -z "$(read_env TANWORDS_ADMIN_KEY)" ]; then
  generated_admin=$(openssl rand -hex 16)
  set_env TANWORDS_ADMIN_KEY "$generated_admin"
fi
# Defence in depth against an accidentally copied/reused value.
if [ "$(read_env TANWORDS_ADMIN_KEY)" = "$(read_env TANWORDS_INVITE_KEY)" ]; then
  generated_admin=$(openssl rand -hex 16)
  set_env TANWORDS_ADMIN_KEY "$generated_admin"
fi
chmod 600 .env

gunzip -c /tmp/tanwords-web-linux-amd64.tar.gz | docker load

# Compatibility with archives produced by older Podman versions/scripts.
if ! docker image inspect tanwords-web:latest >/dev/null 2>&1; then
  docker tag localhost/tanwords-web:latest tanwords-web:latest
fi

# compose.yml/Caddyfile/sqld's trusted public key are the source of truth on
# the developer machine, not the server; every deploy overwrites them here so
# drift (an edited Caddyfile, a rotated TANWORDS_SQLD_AUTH_KEY) always takes
# effect, not just on the first deploy.
mkdir -p sqld
mv /tmp/tanwords-compose.yml compose.yml
mv /tmp/tanwords-Caddyfile caddy/Caddyfile
mv /tmp/tanwords-jwt.pub sqld/jwt.pub

# Creates whatever doesn't exist yet (caddy, on a first deploy) and leaves
# already-running, unchanged services alone — compose only recreates a
# service here if its config actually changed, which `app`/`sqld` need
# forcing for anyway since their image/mounted files change without the
# compose config itself changing.
docker compose up -d
docker compose up -d --no-deps --force-recreate app sqld

container=$(docker compose ps -q app)
healthy=0
for _ in $(seq 1 60); do
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
  case "$status" in
    healthy|running) healthy=1; break ;;
    unhealthy|exited|dead)
      docker compose logs --no-color --tail=100 app
      echo "error: replacement app container entered state: $status" >&2
      exit 1
      ;;
  esac
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  docker compose logs --no-color --tail=100 app
  echo "error: replacement app container did not become healthy" >&2
  exit 1
fi

# sqld has no healthcheck (its image lacks curl/wget); a plain running check
# is enough to catch the failure mode this deploy can actually cause — a bad
# jwt.pub or compose edit making it crash-loop.
sleep 2
sqld_status=$(docker inspect --format '{{.State.Status}}' "$(docker compose ps -q sqld)")
if [ "$sqld_status" != "running" ]; then
  docker compose logs --no-color --tail=100 sqld
  echo "error: sqld container is not running (status: $sqld_status)" >&2
  exit 1
fi

# Caddy normally resolves the recreated `app` service automatically. Reloading
# is cheap and guarantees its upstream configuration uses current Docker DNS.
docker compose exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

public_host=$(awk -F= '$1 == "TANWORDS_PUBLIC_HOST" {sub(/^[^=]*=/, ""); print; exit}' .env)
if [ -z "$public_host" ]; then
  echo "error: TANWORDS_PUBLIC_HOST is missing from the server .env" >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 15 "https://$public_host/" >/dev/null
rm -f /tmp/tanwords-web-linux-amd64.tar.gz

echo
n=$(docker compose ps app sqld caddy)
printf '%s\n' "$n"
echo
echo "Deployment verified: https://$public_host/"

if [ -n "$generated_master" ] || [ -n "$generated_invite" ] || [ -n "$generated_admin" ]; then
  echo
  echo "New server keys were generated and saved to /opt/tanwords/deploy/.env:"
  if [ -n "$generated_master" ]; then
    echo "  TANWORDS_MASTER_KEY=$generated_master"
  fi
  if [ -n "$generated_invite" ]; then
    echo "  TANWORDS_INVITE_KEY=$generated_invite"
  fi
  if [ -n "$generated_admin" ]; then
    echo "  TANWORDS_ADMIN_KEY=$generated_admin"
  fi
  echo
  echo "Back up TANWORDS_MASTER_KEY securely; losing it makes stored credentials unreadable."
else
  echo "Server keys already existed; no keys were generated or printed."
fi
REMOTE

echo
echo "sqld connection for a desktop app (Settings > Cloud tab):"
echo "  URL:   https://$PUBLIC_HOST:8443"
echo "  Token: $(bun "$ROOT/deploy/sqld/sign-token.mjs" 2>/dev/null)"
