# SeaORM: Local SQLite / Cloud PostgreSQL, one query layer

## Context

Product decision: stop trying to make Electron and the web app share data
via a synced embedded replica (libsql/sqld). The new model is simpler:

- **No cloud connection configured → local SQLite**, exactly as today's
  default experience (download and use immediately, zero install).
- **Cloud connection configured → PostgreSQL**, full stop. Not "local SQLite
  with a remote replica" — a direct network connection to a real Postgres
  (can be self-hosted on the user's own server, or anything else that speaks
  Postgres). The user pastes a connection string, like the old Turso
  URL+token flow, and the whole app's data now lives in that Postgres.
- **Cloud does not need offline/replica sync.** This removes the entire
  reason `db/connection.rs` currently carries embedded-replica machinery
  (`TURSO_STARTUP_TIMEOUT`, `SYNC_INTERVAL`, `open_degraded`, `sync_handle`,
  the whole "writes forward to primary, offline degrades to read-only
  replica" design). None of that exists in the new model — Postgres mode is
  just a live network connection, same as any ordinary client-server DB app.
- **Cloud does not support export/vacuum/reset-database.** Those actions get
  hidden in the UI for a Postgres profile (`DbCaps` already has the right
  shape — `export`/`vacuum` flags — just needs `false` for Postgres, same
  pattern already used to hide them for Turso today).

This **fully replaces and decommissions** the just-shipped
per-user-sqld-container feature (`web/server/src/server/sqld_remote.rs`,
`docker-proxy` compose service, Caddy's dynamic per-user vhost push on
8444–8543, per-user `tanwords_lib`/`turso_*` session-switching). That
infrastructure was built for exactly the embedded-replica-sharing problem
this new design sidesteps entirely. It gets deleted, not kept alongside.

The codebase also gets simplified: **one query layer (SeaORM) that runs
unmodified against either backend**, not two parallel implementations of the
same business logic. This is the harder, slower path (vs. writing a separate
Postgres-only implementation) but is the chosen direction.

## Decisions locked in

1. **All ~184 existing SQLite call sites across 42 files get rewritten onto
   SeaORM**, one codebase for both backends. Not a parallel Postgres-only
   implementation.
2. **The per-user sqld container feature is fully decommissioned**, not kept
   running alongside. `docker-proxy` service, Caddy dynamic port range,
   `sqld_remote.rs`, its `/api/db/remote/*` routes, and the Settings UI
   built for it (Enable/Rotate/Disable/URL+token display) all get removed
   and replaced with a plain "paste a Postgres connection string" flow.
3. **Cloud connection = user-pasted connection string.** No server-side
   auto-provisioning of per-user databases/schemas. The server does not
   manage Postgres instances; it just connects to whatever string the user
   gives it (mirrors the old `turso_connect` UX exactly, just a different
   connection string format and a different backend).
4. **Search gets a real native implementation on each backend, not a shared
   query.** SQLite keeps FTS5 (`documents_fts`, `reading_articles_fts`)
   exactly as today. Postgres gets its own proper full-text search —
   `tsvector` columns + GIN indexes + `to_tsquery`/`plainto_tsquery`,
   maintained via triggers the same way FTS5's shadow tables are today (see
   `db/mod.rs:228-249`, `db/migrations/v022_026.rs:46-64` for the FTS5
   pattern to mirror). This is backend-specific code behind a shared
   `search_documents(query) -> Vec<...>`-shaped function signature — the
   *call sites* (`mcp/tools/documents.rs`, `mcp/tools/articles.rs`,
   `db/reading.rs`) branch once on `descriptor.kind` and call the matching
   backend's search, same shape either way to the rest of the app.
5. **VACUUM/export/backup stay SQLite-only, hidden for Postgres** (already
   decided above — `caps.export`/`caps.vacuum` = `false` for a Postgres
   profile, same pattern already used for Turso today). No Postgres
   equivalent planned; not worth building given `pg_dump`/`COPY` are a
   different operational model entirely (needs the `pg_dump` binary /
   server-side privileges, not just a client-side call).
6. **Migration rollout is phased**, not a single PR: build the dual-backend
   scaffold first, prove it end-to-end on 1-2 real tables, then work through
   the rest in table-group batches.
7. **The web backend needs both modes too, not just Postgres.** Each web
   account defaults to its own local SQLite file under
   `state.pool.user_dir(user_id)` (unchanged from today), and can switch to
   a Postgres connection string exactly like Electron does. This falls out
   for free from the shared-core design — `web/server` already runs the same
   `tanwords_lib` `AppState`/`DbProfile`/`db/*.rs` functions as desktop (one
   `AppState`/DB per web user, per `lib.rs:85-88`), so once core supports
   both backends, both `web/server`'s `db_select_source`
   (`web/server/src/server/db.rs:48`, currently `local`/`turso`, becomes
   `local`/`postgres`) and Electron's own connect command
   (`db/connection.rs`'s desktop-facing `db_connect_turso`-equivalent) route
   through the exact same `DbProfile::open()` — no separate implementation
   needed on either side, just two call sites constructing the same enum.

## Current shape (as of this investigation)

- `app/core` (package `tanwords`, lib `tanwords_lib`) and `web/server`
  (package `tanwords-web-server`) are **two separate Cargo crates**, not a
  workspace — `web/server/Cargo.toml:13` pulls core in as a path dependency.
  Both currently depend on `libsql = "0.9.30"` independently
  (`app/core/Cargo.toml:56`, `web/server/Cargo.toml:32`). No `rusqlite`
  actually in use (only referenced in a doc-comment in `db/rows.rs`), no
  `sea-orm`/`sqlx`/`diesel` anywhere yet.
- `db/connection.rs`: `DbProfile::{Local, Turso}`, `Db { database: Arc<Database>, conn: Connection, descriptor }`,
  `open()` builds either via `Builder::new_local` or `Builder::new_remote_replica`.
  All of the Turso-specific logic here (lines ~14-21, ~195-264) is exactly
  what gets deleted — replaced by a `DbProfile::{Local, Postgres}` pair where
  `Postgres` is just "open a connection", no replica/sync concept.
- `db/rows.rs`: `fetch_optional`/`fetch_one`/(presumably `fetch_all`) wrap
  libsql's async row cursor in a rusqlite-`query_row`-shaped API, used at
  ~60 call sites. This is the right seam to replace with SeaORM-flavored
  equivalents so call sites elsewhere don't all need bespoke rewrites of
  their surrounding code, just their SQL/params.
- `db/migrations/mod.rs`: hand-rolled `MIGRATIONS: &[Migration]` const array
  (33 entries across `v001_005.rs`...`v031_035.rs`), tracked in its own
  `schema_migrations(version, applied_at)` table, applied via
  `execute_transactional_batch`. `sea-orm-migration` tracks history in its
  own `seaql_migrations` table via a `Migrator` trait + CLI — **the two
  systems don't share bookkeeping**. Decision: keep the existing hand-rolled
  migration runner for the SQLite path (it works, it's simple, don't touch
  it) and use it as the schema source-of-truth to hand-port into a Postgres
  DDL migration set for `sea-orm-migration` (Postgres starts from a fresh,
  already-current schema — no need to replay 33 incremental SQLite-era
  migrations against it).
- `AppState { db: Mutex<Db>, .. }` (`lib.rs:32-53`), `replace_db()`,
  `build_state_for()` — used identically by desktop and by
  `web/server` (one `AppState`/DB per web user). This is the layer that
  needs its `Db` type's internals swapped (from libsql `Connection` to a
  SeaORM `DatabaseConnection`), but its *external* shape
  (`conn()`/`descriptor()`/`replace_db()`) should stay stable so callers
  outside `db/*.rs` don't need to change.
- `rpc/mod.rs` + `build.rs`'s dispatch table generation is **pure
  text/regex-scan of function signatures** (`#[tauri::command]` etc across
  `src/**/*.rs`) — it has no knowledge of SQL or connection types. Swapping
  the query layer inside `db/*.rs` functions, keeping the same
  `pub async fn db_*(...) -> Result<T, String>` signatures, does not touch
  `rpc/mod.rs`/`build.rs` at all.
- **FTS5** (SQLite-only, stays as-is): `db/mod.rs:228-249` (fresh-DB
  `documents_fts` + triggers), `db/migrations/mod.rs:329` (idempotent
  migration path), `db/migrations/v022_026.rs:46-64` (`reading_articles_fts`),
  `db/migrations/v031_035.rs:28-43` (trigger narrowing), query sites:
  `db/reading.rs:57-64,168`, `mcp/tools/documents.rs:31,61,80`,
  `mcp/tools/articles.rs:60-64`, `mcp/types.rs:202-212` (dup helper),
  `db/import/overwrite.rs:77-197` (`list_fts5_tables`, import-time detection).
- **VACUUM** (SQLite-only, hidden for Postgres):
  `db/settings.rs:32` (`export_backup`, `VACUUM INTO`),
  `db/settings.rs:422` (`db_vacuum`, plain `VACUUM`, already gated by
  `caps.vacuum`), `db/connection.rs:318` (`db_disconnect_remote`,
  `VACUUM INTO` snapshot before switching profiles — this call site itself
  goes away since there's no more replica-to-snapshot-before-disconnecting).
- `users.rs` currently has, from the sqld feature (confirm still present
  before deleting): `turso_url`/`turso_token_enc` columns +
  `turso_for`/`set_turso`/`clear_turso`/`remembered_turso` (line ~451-553),
  and `sqld_key_enc`/`sqld_port`/`sqld_enabled` columns +
  `sqld_remote_for`/`used_sqld_ports`/`set_sqld_remote`/`enabled_sqld_routes`/
  `set_sqld_enabled` (line ~555-655).

## Target architecture

**`DbProfile`** becomes:
```rust
pub enum DbProfile {
    Local { path: String },
    Postgres { url: String },   // full libpq-style connection string, incl. credentials
}
```
No more `Turso` variant, no replica path, no sync interval, no
offline/degraded mode, no `TURSO_STARTUP_TIMEOUT`. `open()` becomes: build a
`sea_orm::Database::connect(...)` against either a `sqlite://` or the given
Postgres URL, then run schema setup (existing hand-rolled runner for
SQLite; `sea-orm-migration`'s `Migrator::up()` for Postgres).

**`Db`** wraps a `sea_orm::DatabaseConnection` instead of
`libsql::{Database, Connection}`. `conn()`/`descriptor()` keep their current
signatures where practical so `AppState` and everything above it changes
minimally.

**Query layer migration, in order** (the actual multi-week body of work):

1. **Scaffold phase**: add `sea-orm` (features: `sqlx-sqlite`,
   `sqlx-postgres`, `runtime-tokio-rustls`, `macros`) + `sea-orm-migration`
   to `app/core/Cargo.toml`. Rewrite `db/connection.rs` and `db/rows.rs`
   (new SeaORM-flavored `fetch_optional`/`fetch_one`/`fetch_all` helpers,
   using `Statement::from_sql_and_values(db.get_database_backend(), sql, params)`
   + `db.query_one`/`query_all`) — **one open technical question to spike
   first**: confirm SeaORM's raw-statement path is truly placeholder-portable
   across backends, or whether call sites still need `?1` vs `$1` handled
   per-backend. If not fully portable, `fetch_*` helpers can paper over it by
   taking the SQL as a per-backend pair or by using SeaORM's `Value`-based
   query builder instead of raw strings for the highest-traffic queries.
2. **Prove it end-to-end on 1-2 tables** (suggest `words`/`patterns` — no
   FTS5, no VACUUM, well-isolated in `db/words_*.rs`/`db/patterns.rs`) against
   both a local SQLite file and a real local Postgres instance, before
   touching anything else.
3. **Batch through the remaining ~40 files** grouped by feature area.
   Documents/reading (search) needs the Postgres `tsvector`/GIN schema +
   trigger design done alongside it — budget extra time for that batch.
   Settings/backup (VACUUM) is simpler: Postgres just gets `caps.export`/
   `caps.vacuum = false`, no new code beyond the capability flag.
4. **Migration authoring for Postgres**: one clean `sea-orm-migration` set
   that creates the current (v33) schema directly in Postgres DDL — do not
   try to replay all 33 SQLite migrations verbatim; hand-port the *current*
   `CREATE TABLE` shapes from `db/mod.rs`/the migration consts, translating
   SQLite-isms (`AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`, `TEXT`
   dates → `TIMESTAMPTZ` where it's actually a timestamp, etc.) as they're
   ported.

**Decommission list** (delete, not deprecate):

- `web/server/src/server/sqld_remote.rs` and its routes in
  `web/server/src/server/mod.rs`.
- `docker-proxy` service block in `deploy/compose.yml`, the Caddy dynamic
  port range (8444-8543) and admin-API push wiring in `deploy/caddy/`, the
  `ufw allow 8444:8543` line in `deploy/deploy-server.sh`.
- `users.rs` `sqld_key_enc`/`sqld_port`/`sqld_enabled` columns and helpers.
- Frontend: `DataSection.tsx`/`useDataSection.ts`/`useDBData.ts` Enable /
  show-URL+token / Rotate-with-confirm / Disable UI — replaced with a single
  "paste Postgres connection string" input + Connect/Disconnect, modeled
  directly on the existing `turso_connect`/`turso_disconnect` flow in
  `web/server/src/server/db.rs` (same save-first-respawn-second pattern,
  same AES-sealed storage via `UsersDb::seal`/`unseal` — just store a
  connection string instead of a URL+token pair).
- Note: the *existing* `turso_url`/`turso_token_enc`/`turso_for`/`set_turso`/
  `clear_turso` machinery in `users.rs`/`db.rs` is close enough in shape to
  reuse (rename/repurpose to `postgres_url_enc`, drop the separate-token
  field since a Postgres connection string carries its own credentials)
  rather than deleting and rewriting from scratch.

## Open items to resolve during the scaffold phase

- **`web/server/Cargo.toml`'s own `libsql` dependency** (separate from
  core's, added specifically for `sqld_remote.rs` per its Cargo.toml
  comment) gets dropped once `sqld_remote.rs` is deleted. Whether
  `web/server` needs `sea-orm` as a direct dependency too (vs. only using it
  indirectly through `tanwords_lib`'s public API) gets decided once the
  scaffold's actual API surface exists.
- **Connection-string validation before saving.** The current
  `turso_connect` (`web/server/src/server/db.rs:171`) runs
  `resolve_public()` — an SSRF guard rejecting private/internal hosts —
  against the user-supplied URL before dialing it. That guard is
  http(s)-shaped (`turso_probe_url` rewrites `libsql://` to `https://`); a
  Postgres connection string (`postgres://user:pass@host:port/db`) needs
  its own equivalent host-extraction + `resolve_public()` call, not a
  straight reuse of the existing helper.
- **`DbCaps.switch_path`** (the "point desktop at a different local file"
  capability) should be `false` for a Postgres profile, same reasoning as
  `export`/`vacuum` — add it alongside those when `DbCaps` gets its
  Postgres-profile values defined.
- **Rough timeline**: this is a multi-week effort (184 call sites / 42
  files), not a single sprint — track it batch-by-batch per the phased
  rollout above rather than expecting one continuous push.

## Verification

- Unit tests for the new `fetch_optional`/`fetch_one`/`fetch_all` helpers
  against both an in-memory SQLite and a local test Postgres (docker), same
  test bodies parameterized over both backends where feasible.
- After the 1-2 table spike: manually run the app against a local Postgres
  (`docker run postgres`), exercise create/edit/delete on the migrated
  tables from the UI, confirm identical behavior to SQLite mode.
- After each batch: full `cargo check`/`cargo test` on both crates, plus a
  manual smoke pass through that feature area's UI against both backends.
- No production users currently exist, so the sqld infra and its
  `turso_*`/`sqld_*` columns can be decommissioned outright — no
  compatibility check or user heads-up needed before deleting them.
