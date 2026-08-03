#!/usr/bin/env bash
# Web-version dev loop: Rust server + Vite with HMR, one command.
#
# The renderer talks to its server over same-origin relative paths, so Vite
# proxies /invoke, /api and /events to the port below (see vite.config.ts).
# Editing anything under app/src hot-reloads; only Rust changes need a restart.
set -euo pipefail

cd "$(dirname "$0")/.."
SERVER_DIR="$(cd ../web/server && pwd)"

# Fixed, not random: TANWORDS_MASTER_KEY decrypts stored provider API keys, so
# regenerating it every run would silently invalidate every key you saved.
export TANWORDS_MASTER_KEY="${TANWORDS_MASTER_KEY:-00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff}"
export TANWORDS_INVITE_KEY="${TANWORDS_INVITE_KEY:-dev}"
# Dev data and secrets stay inside web/server, well away from the desktop
# app's real database.
export TANWORDS_SECRET_FILE_DIR="${TANWORDS_SECRET_FILE_DIR:-$SERVER_DIR/.dev-secrets}"
export TANWORDS_DATA_DIR="${TANWORDS_DATA_DIR:-$SERVER_DIR/.dev-data}"
export TANWORDS_PORT="${TANWORDS_PORT:-8740}"

# A leftover server from a previous run fails deep inside Rust with
# "Address already in use (os error 48)", which says nothing about what to do.
if lsof -nP -iTCP:"$TANWORDS_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev:web] port $TANWORDS_PORT is already in use — another server is still running."
  echo "[dev:web] stop it with:  pkill -f tanwords-web-server"
  echo "[dev:web] or pick another port:  TANWORDS_PORT=8741 bun run dev:web"
  exit 1
fi

echo "[dev:web] backend  http://127.0.0.1:$TANWORDS_PORT   (invite key: $TANWORDS_INVITE_KEY)"
echo "[dev:web] frontend http://localhost:5420             <- open this one"

(cd "$SERVER_DIR" && cargo run) &
SERVER_PID=$!
# Whatever ends the script — Ctrl-C, Vite exiting, an error — takes the server
# with it. Otherwise the next run fails with "address already in use".
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT INT TERM

TANWORDS_WEB_DEV=1 TANWORDS_WEB_SERVER="http://127.0.0.1:$TANWORDS_PORT" bunx vite
