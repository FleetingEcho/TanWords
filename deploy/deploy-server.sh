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

echo "==> loading image and replacing app container"
ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "$PUBLIC_HOST" <<'REMOTE'
set -euo pipefail
public_host_arg=$1
cd /opt/tanwords/deploy

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

docker compose up -d --no-deps --force-recreate app

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
n=$(docker compose ps app caddy)
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
