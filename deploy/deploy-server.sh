#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_ENV=${TANWORDS_DEPLOY_ENV:-"$ROOT/deploy/.env"}
ARCHIVE="$ROOT/deploy/tanwords-web-linux-amd64.tar.gz"
POSTGRES_ARCHIVE="$ROOT/deploy/tanwords-postgres-linux-amd64.tar.gz"
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

touch "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"

usage() {
  echo "Usage: $0 [--skip-build] [user@host]"
  echo
  echo "Builds the Linux/amd64 runtime and postgres images locally, uploads"
  echo "them, replaces the app/postgres containers, and verifies the public"
  echo "HTTPS endpoint."
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
  "$ROOT/deploy/build-image-postgres.sh" "$POSTGRES_ARCHIVE"
elif [[ ! -f "$ARCHIVE" || ! -f "$POSTGRES_ARCHIVE" ]]; then
  echo "error: $ARCHIVE and/or $POSTGRES_ARCHIVE do not exist; omit --skip-build" >&2
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

echo "==> uploading compiled runtime images"
scp "${SSH_OPTS[@]}" "$ARCHIVE" "$TARGET:/tmp/tanwords-web-linux-amd64.tar.gz"
scp "${SSH_OPTS[@]}" "$POSTGRES_ARCHIVE" "$TARGET:/tmp/tanwords-postgres-linux-amd64.tar.gz"

echo "==> uploading deploy configuration"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/compose.yml" "$TARGET:/tmp/tanwords-compose.yml"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/caddy/Caddyfile" "$TARGET:/tmp/tanwords-Caddyfile"

echo "==> loading images and replacing containers"
ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "$PUBLIC_HOST" <<'REMOTE'
set -euo pipefail
public_host_arg=$1

# Bootstrap a genuinely clean server: the directory this whole script `cd`s
# into next, Docker itself, and the inbound ports Caddy/Postgres need. All of
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
  ufw allow 5432/tcp comment 'TanWords Postgres' >/dev/null
  # Old per-user sqld remote-connection range, retired in favor of the
  # shared Postgres instance above — close it if it was ever opened.
  ufw delete allow 8443/tcp >/dev/null 2>&1 || true
  ufw delete allow 8444:8543/tcp >/dev/null 2>&1 || true
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
generated_postgres=""

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
if [ -z "$(read_env TANWORDS_POSTGRES_SUPERUSER_PASSWORD)" ]; then
  generated_postgres=$(openssl rand -hex 32)
  set_env TANWORDS_POSTGRES_SUPERUSER_PASSWORD "$generated_postgres"
fi
chmod 600 .env

gunzip -c /tmp/tanwords-web-linux-amd64.tar.gz | docker load
gunzip -c /tmp/tanwords-postgres-linux-amd64.tar.gz | docker load

# Compatibility with archives produced by older Podman versions/scripts.
if ! docker image inspect tanwords-web:latest >/dev/null 2>&1; then
  docker tag localhost/tanwords-web:latest tanwords-web:latest
fi
if ! docker image inspect tanwords-postgres:latest >/dev/null 2>&1; then
  docker tag localhost/tanwords-postgres:latest tanwords-postgres:latest
fi

# compose.yml/Caddyfile are the source of truth on the developer machine, not
# the server; every deploy overwrites them here so drift (an edited
# Caddyfile, a compose.yml change) always takes effect, not just on the
# first deploy.
mv /tmp/tanwords-compose.yml compose.yml
mv /tmp/tanwords-Caddyfile caddy/Caddyfile

# Creates whatever doesn't exist yet (caddy, on a first deploy) and leaves
# already-running, unchanged services alone — compose only recreates a
# service here if its config actually changed, which `app`/`postgres` need
# forcing for anyway since their image/mounted files change without the
# compose config itself changing.
docker compose up -d
docker compose up -d --no-deps --force-recreate app postgres

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

postgres_container=$(docker compose ps -q postgres)
postgres_healthy=0
for _ in $(seq 1 60); do
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$postgres_container")
  case "$status" in
    healthy|running) postgres_healthy=1; break ;;
    unhealthy|exited|dead)
      docker compose logs --no-color --tail=100 postgres
      echo "error: replacement postgres container entered state: $status" >&2
      exit 1
      ;;
  esac
  sleep 2
done
if [ "$postgres_healthy" -ne 1 ]; then
  docker compose logs --no-color --tail=100 postgres
  echo "error: replacement postgres container did not become healthy" >&2
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
rm -f /tmp/tanwords-web-linux-amd64.tar.gz /tmp/tanwords-postgres-linux-amd64.tar.gz

echo
n=$(docker compose ps app postgres caddy)
printf '%s\n' "$n"
echo
echo "Deployment verified: https://$public_host/"

if [ -n "$generated_master" ] || [ -n "$generated_invite" ] || [ -n "$generated_admin" ] || [ -n "$generated_postgres" ]; then
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
  if [ -n "$generated_postgres" ]; then
    echo "  TANWORDS_POSTGRES_SUPERUSER_PASSWORD=$generated_postgres"
  fi
  echo
  echo "Back up TANWORDS_MASTER_KEY securely; losing it makes stored credentials unreadable."
else
  echo "Server keys already existed; no keys were generated or printed."
fi
REMOTE
