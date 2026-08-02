# TanWords Web

The web version: one Rust (axum) backend serving a Vite + React 19 + TSX SPA,
usable from desktop and mobile browsers. Multi-user: email+password accounts,
invite-key-gated registration, and each account points at its own Turso
instance (or the per-user local DB by default).

## Quickstart

1. Build the shared renderer once:

```bash
cd app && bun install && bun run build
```

2. Start the web server:

```bash
cd ../web/server
TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
TANWORDS_INVITE_KEY=choose-a-key \
cargo run --release
```

3. Open `http://127.0.0.1:8740` and register with the invite key.

From a phone on the LAN, set `TANWORDS_HOST=0.0.0.0` first and open
`http://<your-computer-ip>:8740`.

Unset `TANWORDS_INVITE_KEY` after everyone is registered to close the doors.

## Single-binary deployment

The renderer is embedded into `web/server` at build time. Verified:

- `cargo build --release` succeeds.
- Without `TANWORDS_WEB_DIST`, startup logs `serving embedded SPA`.
- `http://127.0.0.1:8741/` returns `200 OK`.

```bash
cd app
bun run build

cd ../web/server
cargo build --release
```

Artifact:

```text
web/server/target/release/tanwords-web-server
```

Copy only that binary and run:

```bash
TANWORDS_MASTER_KEY=... \
TANWORDS_INVITE_KEY=... \
TANWORDS_HOST=0.0.0.0 \
TANWORDS_PORT=8740 \
./tanwords-web-server
```

## Docs

- Server API, env vars, per-user Turso, deployment notes: [server/README.md](server/README.md)
- Design + implementation plan: [plan.md](plan.md)
