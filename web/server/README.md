# tanwords-web-server

The TanWords web backend: one Rust/axum binary serving the SPA plus a
**multi-user** command API (same dispatch table as the desktop sidecar) with
email+password accounts, invite-key-gated registration, and per-user data
isolation — each active user gets their own core runtime around their own
database (a per-user local SQLite file, or their own Turso embedded replica).

The built renderer is embedded into the release binary by default, so
deployment only needs the `tanwords-web-server` executable.

## Run

```bash
cd ../app && bun install && bun run build          # build the shared renderer once
cd ../web/server
TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
TANWORDS_INVITE_KEY=only-you-know-this \
cargo run --release
```

The resulting binary is `target/release/tanwords-web-server`. It serves the
embedded `app/out/renderer`; no `TANWORDS_WEB_DIST` directory is required at
runtime.

## Single-binary verification

- `cargo build --release` succeeds.
- Without `TANWORDS_WEB_DIST`, startup logs `serving embedded SPA`.
- `http://127.0.0.1:8741/` returns `200 OK`.

Deploy by copying only the binary:

```text
web/server/target/release/tanwords-web-server
```

Run it:

```bash
TANWORDS_MASTER_KEY=... \
TANWORDS_INVITE_KEY=... \
TANWORDS_HOST=0.0.0.0 \
TANWORDS_PORT=8740 \
./tanwords-web-server
```

### Environment

| Var | Required | Default | Meaning |
|---|---|---|---|
| `TANWORDS_MASTER_KEY` | **yes** | — | 32 bytes, hex or base64. Seals each user's Turso token + AI provider keys on disk. Generate: `openssl rand -hex 32`. |
| `TANWORDS_INVITE_KEY` | no | unset | Gates **register** and **reset-password**. Unset = those doors are closed (existing logins still work). Rotate by restarting with a new value. |
| `TANWORDS_HOST` | no | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN/behind a proxy. |
| `TANWORDS_PORT` | no | `8740` | Port. |
| `TANWORDS_DATA_DIR` | no | platform data dir | Root for `users.db` and `users/<id>/` data. |
| `TANWORDS_WEB_DIST` | no | embedded SPA | Optional external built SPA directory, for development or swapping builds without recompiling. Unset = serve from the binary. |

## API surface (auth)

| Route | Body | Notes |
|---|---|---|
| `POST /api/auth/register` | `{email, password, inviteKey}` | 403 when invite key unset/wrong. Returns `{token}` (auto-login). |
| `POST /api/auth/login` | `{email, password}` | `{token}`; rate-limited 10 failures / 10 min / IP. |
| `POST /api/auth/reset-password` | `{email, newPassword, inviteKey}` | Owner-assisted reset (no SMTP): the invite key proves the owner approved it. Kills all sessions of that account. |
| `POST /api/auth/logout` | Bearer | 204 |
| `GET /api/auth/me` | Bearer | `{email}` |

Everything else — `POST /invoke/{command}`, `GET /events` (SSE, per-user
broadcast), `GET /api/assets/:id`, `POST /api/import/upload`,
`POST /api/import/analyze|apply` (uploads-dir paths only), `GET
/api/export/backup`, the `/api/db/*` profile routes below, and
`POST /api/ai-proxy/:id/*` — requires the session (`Authorization: Bearer`
or `?token=` where headers are impossible).

## Per-user data & Turso

Each account starts on a per-user local DB (`<data_dir>/users/<id>/tanwords.db`),
so the app is fully usable with no Turso at all. In Settings → Data a user can
point their account at *any* Turso database (URL + token) — stored per-user,
token AES-256-GCM-sealed under `TANWORDS_MASTER_KEY`:

- `POST /api/db/turso/connect` `{url, token}` — fresh replica sync, live swap.
- `POST /api/db/turso/disconnect` — back to the local DB, clears the stored profile.
- `POST /api/db/turso/forget` — clears the stored profile without touching the live one (for stuck/dead profiles).
- `GET  /api/db/turso/remembered` — `{url, tokenPresent}` (never the token).
- `GET  /api/db/profile` — `{connection: <DbDescriptor>, remembered: {...}}`.

If a saved Turso profile fails to open at spawn time (primary down, token
revoked), the runtime falls back to the local DB and surfaces a startup
warning in the app instead of locking the user out.

The desktop commands that are global-machine-scoped
(`db_connect_turso`, `db_disconnect_remote`, `db_forget_saved_profile`,
`db_get_remembered_turso`, `db_saved_profile_is_turso`, `db_switch_path`,
`secret_*`) or take arbitrary filesystem paths (`db_export_backup`,
`db_import_*`, `db_export_document_assets_*`, `db_get_db_path`) are **blocked
by name from `/invoke`** on purpose; the routes above replace them per-user.

## Deployment notes

- Multi-user lite, not multi-tenant scale: designed for you + invited friends
  on a box you control. `users.db` holds argon2id hashes and sha256'd session
  tokens; sessions slide-expire after 30 days idle.
- HTTPS: put Caddy/nginx in front (`reverse_proxy 127.0.0.1:8740`). The SSE
  and AI-proxy streams are flushed unbuffered and proxy-safe; send
  `X-Forwarded-For` if you want the rate limiter to see real client IPs
  (it uses the direct peer address).
- Backup `TANWORDS_MASTER_KEY` — losing it orphans every sealed Turso token
  and AI provider key (users re-enter them; no data loss otherwise).
