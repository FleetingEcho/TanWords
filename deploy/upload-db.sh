#!/usr/bin/env bash
set -euo pipefail

# Imports a local SQLite database file as one server user's local (non-Turso)
# database, or lists the accounts registered on the server so you know which
# user id to target. Per-user local databases live at
# /data/users/<user_id>/tanwords.db inside the `tanwords-data` volume (see
# web/server/src/runtime.rs and app/core/src/lib.rs::open_user_db).

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_ENV=${TANWORDS_DEPLOY_ENV:-"$ROOT/deploy/.env"}
REMOTE_DEPLOY_DIR=${TANWORDS_REMOTE_DEPLOY_DIR:-/opt/tanwords/deploy}

PUBLIC_HOST=${TANWORDS_PUBLIC_HOST:-}
if [[ -z "$PUBLIC_HOST" && -f "$DEPLOY_ENV" ]]; then
  PUBLIC_HOST=$(awk -F= '$1 == "TANWORDS_PUBLIC_HOST" {sub(/^[^=]*=/, ""); print; exit}' "$DEPLOY_ENV")
fi

usage() {
  echo "Usage:"
  echo "  $0 list-users [user@host]"
  echo "  $0 upload <local-db-file> <user-id> [user@host]"
  echo
  echo "list-users prints the id/email of every registered account, so you"
  echo "know which user id to pass to 'upload'."
  echo
  echo "upload replaces that user's local tanwords.db inside the server's"
  echo "tanwords-data volume with <local-db-file>. The app service is"
  echo "stopped for the duration of the copy and restarted afterward. Any"
  echo "existing data for that user is overwritten — there is no undo."
  echo
  echo "The target defaults to root@TANWORDS_PUBLIC_HOST from deploy/.env."
}

resolve_target() {
  local host=${1:-}
  if [[ -n "$host" ]]; then
    echo "$host"
    return
  fi
  if [[ -z "$PUBLIC_HOST" ]]; then
    echo "error: set TANWORDS_PUBLIC_HOST in $DEPLOY_ENV, or pass user@host explicitly" >&2
    exit 1
  fi
  if [[ ! "$PUBLIC_HOST" =~ ^[A-Za-z0-9.:-]+$ ]]; then
    echo "error: TANWORDS_PUBLIC_HOST contains unsupported characters" >&2
    exit 1
  fi
  echo "root@$PUBLIC_HOST"
}

# Opens one multiplexed SSH connection so password auth (if used) is
# requested once and reused by scp/ssh, mirroring deploy-server.sh.
open_ssh_mux() {
  local target=$1
  SSH_DIR=$(mktemp -d /tmp/tanwords-ssh.XXXXXX)
  SSH_SOCKET="$SSH_DIR/control"
  # shellcheck disable=SC2064
  trap "ssh -o ControlPath='$SSH_SOCKET' -O exit '$target' >/dev/null 2>&1 || true; rm -rf '$SSH_DIR'" EXIT
  SSH_OPTS=(-o ControlPath="$SSH_SOCKET")
  ssh -o ControlMaster=yes -o ControlPath="$SSH_SOCKET" -o ControlPersist=120 -Nf "$target"
}

cmd_list_users() {
  local target
  target=$(resolve_target "${1:-}")
  echo "==> connecting to $target"
  open_ssh_mux "$target"

  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "error: sqlite3 is required locally to read users.db (brew install sqlite3)" >&2
    exit 1
  fi

  local remote_tmp="/tmp/tanwords-users-$$.db"
  local local_tmp
  local_tmp=$(mktemp /tmp/tanwords-users.XXXXXX.db)
  trap "rm -f '$local_tmp'" EXIT

  echo "==> reading users.db"
  ssh "${SSH_OPTS[@]}" "$target" \
    "docker cp \$(docker compose -f '$REMOTE_DEPLOY_DIR/compose.yml' ps -q app):/data/users.db '$remote_tmp'"
  scp "${SSH_OPTS[@]}" "$target:$remote_tmp" "$local_tmp"
  ssh "${SSH_OPTS[@]}" "$target" "rm -f '$remote_tmp'"

  echo
  printf '%-8s %s\n' "id" "email"
  sqlite3 "$local_tmp" "select id, email from users order by id;" \
    | awk -F'|' '{printf "%-8s %s\n", $1, $2}'
  rm -f "$local_tmp"
}

cmd_upload() {
  local local_db=${1:-}
  local user_id=${2:-}
  local target
  target=$(resolve_target "${3:-}")

  if [[ -z "$local_db" || -z "$user_id" ]]; then
    usage >&2
    exit 2
  fi
  if [[ ! -f "$local_db" ]]; then
    echo "error: $local_db does not exist" >&2
    exit 1
  fi
  if [[ ! "$user_id" =~ ^[0-9]+$ ]]; then
    echo "error: user-id must be numeric (use '$0 list-users' to look it up)" >&2
    exit 1
  fi

  echo "==> connecting to $target"
  open_ssh_mux "$target"

  echo "==> uploading $(du -h "$local_db" | cut -f1) database"
  ssh "${SSH_OPTS[@]}" "$target" "mkdir -p /tmp/tanwords-upload"
  scp "${SSH_OPTS[@]}" "$local_db" "$target:/tmp/tanwords-upload/tanwords.db"

  echo "==> stopping app, replacing user $user_id's local database, restarting"
  ssh "${SSH_OPTS[@]}" "$target" bash -s -- "$user_id" "$REMOTE_DEPLOY_DIR" <<'REMOTE'
set -euo pipefail
user_id=$1
deploy_dir=$2
cd "$deploy_dir"

docker compose stop app

# A throwaway container mounting the same named volume does the file
# surgery, so this works whether the app container is up or down and
# never needs its own shell tools beyond what the image already has.
docker run --rm -u 0 \
  -v tanwords-data:/data \
  -v /tmp/tanwords-upload:/host:ro \
  --entrypoint sh \
  tanwords-web:latest -c '
    set -e
    mkdir -p "/data/users/'"$user_id"'"
    rm -f "/data/users/'"$user_id"'/tanwords.db" \
          "/data/users/'"$user_id"'/tanwords.db-wal" \
          "/data/users/'"$user_id"'/tanwords.db-shm"
    cp /host/tanwords.db "/data/users/'"$user_id"'/tanwords.db"
    chown -R 10001:10001 "/data/users/'"$user_id"'"
  '

rm -rf /tmp/tanwords-upload

docker compose up -d --no-deps app

container=$(docker compose ps -q app)
healthy=0
for _ in $(seq 1 60); do
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
  case "$status" in
    healthy|running) healthy=1; break ;;
    unhealthy|exited|dead)
      docker compose logs --no-color --tail=100 app
      echo "error: app container entered state: $status" >&2
      exit 1
      ;;
  esac
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  docker compose logs --no-color --tail=100 app
  echo "error: app container did not become healthy" >&2
  exit 1
fi

echo "Done: user $user_id's local database was replaced and the app is healthy again."
REMOTE
}

case "${1:-}" in
  -h|--help|"") usage; [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && exit 0; exit 2 ;;
  list-users) shift; cmd_list_users "$@" ;;
  upload) shift; cmd_upload "$@" ;;
  *) echo "error: unknown subcommand: $1" >&2; usage >&2; exit 2 ;;
esac
