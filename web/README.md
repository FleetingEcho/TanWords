# TanWords Web

The web version: one Rust (axum) backend serving a Vite + React 19 + TSX SPA,
usable from desktop and mobile browsers. Multi-user: email+password accounts,
invite-key-gated registration, and each account points at its own Turso
instance (or the per-user local DB by default).

## Quickstart

```bash
cd web/frontend && bun install && bun run build
cd ../server && TANWORDS_MASTER_KEY=$(openssl rand -hex 32) TANWORDS_INVITE_KEY=choose-a-key cargo run --release
```

Then open `http://127.0.0.1:8740` (from a phone on the LAN, set
`TANWORDS_HOST=0.0.0.0` first) and register with your invite key.

Unset `TANWORDS_INVITE_KEY` after everyone is registered to close the doors.

## Docs

- Server API, env vars, per-user Turso, deployment notes: [server/README.md](server/README.md)
- Design + implementation plan: [plan.md](plan.md)
