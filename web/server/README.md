# tanwords-web-server

The TanWords web backend: one Rust/axum binary serving the SPA plus a
**multi-user** command API (same dispatch table as the desktop sidecar) with
email+password accounts, invite-key-gated registration, and per-user data
isolation — each active user gets their own core runtime around their own
database (a per-user local SQLite file, or their own self-provisioned
Postgres role+database in the shared `postgres` instance).

The built renderer is embedded into the release binary by default, so
deployment only needs the `tanwords-web-server` executable.

## Run

There is a Makefile one directory up; it knows the build order, which is the
one thing that is easy to get wrong (the renderer is compiled *into* the
server binary, so it has to exist first).

```bash
cd web
make doctor     # is bun/cargo present, is there an .env
make keys       # generate server/.env with fresh secrets — once per host
make build      # renderer, then the single release binary
make run        # start it
```

`make` on its own lists every target. The long way, if you prefer it explicit:

```bash
cd ../app && bun install && bun run build          # build the shared renderer once
cd ../web/server
TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
TANWORDS_INVITE_KEY=give-this-to-people-you-invite \
TANWORDS_ADMIN_KEY=keep-this-one-to-yourself \
cargo run --release
```

`make run` refuses to start when `TANWORDS_ADMIN_KEY` equals
`TANWORDS_INVITE_KEY` — see the environment table below for why that
combination hands every invited user control of every account.

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
| `TANWORDS_MASTER_KEY` | **yes** | — | 32 bytes, hex or base64. Seals each user's Postgres password + AI provider keys on disk and signs web JWTs. Generate: `openssl rand -hex 32`. |
| `TANWORDS_JWT_TTL_SECS` | no | `604800` | Absolute JWT lifetime in seconds (one week by default). |
| `TANWORDS_INVITE_KEY` | no | unset | Gates **register** only. This is the one you hand to people you invite. Unset = registration closed (existing logins still work). |
| `TANWORDS_ADMIN_KEY` | no | unset | Gates **reset-password**. Keep it to yourself — it can set any account's password from its email address alone. **Must not equal the invite key**: sharing one secret between the two doors gives every invited user the ability to take over every other account, including yours. Unset = password reset closed. |
| `TANWORDS_TRUST_PROXY` | no | `false` | Set to `1` only when nothing can reach this port except your reverse proxy. Makes the rate limiter read the last hop of `X-Forwarded-For` instead of the peer address. Leaving it off behind a proxy means every user shares one rate-limit bucket, so ten failed logins from anyone lock out everyone. Turning it on while the port is directly reachable lets any caller forge a fresh identity per request and skip the limiter entirely. |
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
`GET|POST /api/ai-proxy/:id/*` (the request method is preserved upstream —
the settings page lists models via `GET /models` and chats via
`POST /chat/completions`) — requires the session (`Authorization: Bearer`
or `?token=` where headers are impossible).

## Per-user data & Postgres remote access

Each account starts on a per-user local DB (`<data_dir>/users/<id>/tanwords.db`),
so the app is fully usable with no Postgres at all. In Settings → Data a user
can provision their own role+database inside the server's shared `postgres`
instance (see `server/postgres_remote/`) — the password is AES-256-GCM-sealed
under `TANWORDS_MASTER_KEY`:

- `GET  /api/db/postgres/status` — `{enabled, url}` (no password).
- `POST /api/db/postgres/enable` — provisions (first call) or re-enables, switches the session onto it, returns `{enabled: true, url}` with the password inline this once.
- `POST /api/db/postgres/rotate` — new password; old one stops working immediately.
- `POST /api/db/postgres/disable` — revokes `LOGIN` (role/database and data are kept) and switches the session back to local.
- `GET  /api/db/profile` — `{connection: <DbDescriptor>}`.
- `GET  /api/export/backup?source=local` — exports the local database; paths are always derived from the authenticated user id.

If a saved Postgres profile fails to open at spawn time (unreachable, rotated
credentials), the runtime falls back to the local DB and surfaces a startup
warning in the app instead of locking the user out.

The desktop commands that are global-machine-scoped
(`db_connect_postgres`, `db_disconnect_remote`, `db_switch_path`,
`secret_*`) or take arbitrary filesystem paths (`db_export_backup`,
`db_export_postgres_backup`, `db_import_*`, `db_export_document_assets_*`,
`db_get_db_path`, `db_get_default_local_path`) are **blocked by name from
`/invoke`** on purpose; the routes above replace them per-user.

## Deployment notes

- Multi-user lite, not multi-tenant scale: designed for you + invited friends
  on a box you control. `users.db` holds Argon2id hashes and revocable hashes
  of signed JWTs; JWTs expire after one week by default.
- HTTPS: put Caddy/nginx in front (`reverse_proxy 127.0.0.1:8740`). The SSE
  and AI-proxy streams are flushed unbuffered and proxy-safe. Have the proxy
  set `X-Forwarded-For` **and** run the server with `TANWORDS_TRUST_PROXY=1`,
  or the rate limiter counts every request against the proxy's own address —
  one attacker's failed logins then lock out every user at once. Keep the
  server bound to `127.0.0.1` so the port is genuinely unreachable except
  through the proxy; that is the precondition the header trust rests on.
- Add HSTS at the proxy. The server itself speaks plain HTTP by design.
- File permissions: `users.db` 0600 and `users/` 0700. They hold password
  hashes, session tokens and sealed third-party credentials.
- Backup `TANWORDS_MASTER_KEY` — losing it orphans every sealed Postgres
  password and AI provider key (users re-enter/rotate them; no data loss
  otherwise).

## What the server will not do

The command API is an **allowlist** (`src/commands.rs`), not a filter over the
desktop command set. The core's dispatch table is written for an app where the
caller owns the machine; here the caller is whoever holds a session on a box
reachable from the internet, and those are different trust models. A command
added to the core is *not* published here until somebody classifies it — the
test in that file fails until they do.

Refused for structural reasons, with the per-user replacements noted in the
file: anything that reads or writes an arbitrary server path (`db_import_*`,
`db_export_*` — re-exposed as validated `/api/import/*` and
`/api/export/backup`), anything backed by process-wide state rather than the
caller's own database (`secret_*`, `app_lock_*`, the `db_connect_postgres`
family — re-exposed per user under `/api/db/*`), anything that would have the
server bind a listener (`mcp_*`), and `ai_provider_key`, which would hand a
decrypted provider key to the browser that `/api/ai-proxy` exists to keep it
away from.

Outbound fetches of user-supplied URLs (`fetch_article`, `fetch_rss`, the RSS
sync, the AI proxy's configurable `api_base`) are allowed but
guarded: the host is resolved first, refused if any answer lands in private,
loopback, link-local or carrier-grade-NAT space — 169.254.169.254 above all —
and the connection is pinned to the address that was checked so the name
cannot resolve elsewhere in between. Redirects are followed by hand so every
hop gets the same treatment. See `app/core/src/http_util.rs`.
