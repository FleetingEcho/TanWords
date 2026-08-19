//! Where the database actually lives, and how the rest of the app gets at it.
//!
//! Two live profiles, one API. `Local` is a plain SQLite file, exactly as
//! before. `Postgres` is a direct network connection to a user-supplied
//! Postgres (the user pastes a libpq-style connection string; the whole app's
//! data lives in that database). Everything downstream of `AppState::conn()`
//! is identical between the two — both go through the same SeaORM
//! [`Conn`][crate::db::rows::Conn] and the same query helpers.
//!
//! The `Turso` variant is kept on the enum so existing config files and the
//! web server's `turso_connect` path still deserialize/compile, but `open()`
//! refuses it: the embedded-replica design is gone (the SeaORM migration
//! retired libsql), and a Postgres connection string replaces it. The
//! server-side sqld provisioning infrastructure is decommissioned separately.

use serde::{Deserialize, Serialize};

use crate::db::rows::Conn;

/// Which kind of database a profile points at. `Turso` remains only so the
/// retired variant's bookkeeping (`await_write`'s timeout policy, config
/// round-trips) keeps type-checking; no live connection is ever opened for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Local,
    Turso,
    Postgres,
}

/// A saved connection profile. Secrets are not part of this — a Postgres
/// connection string carries its own credentials inline, so the whole
/// credential lives in the profile (sealed at rest by the web server, see
/// `UsersDb::seal`), not in the OS keychain the way Turso's token did.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DbProfile {
    Local {
        path: String,
    },
    /// Kept for config/web-server compatibility; `open()` returns an error.
    /// Decommissioning the surrounding server-side sqld infra is a follow-up.
    Turso {
        path: String,
        url: String,
    },
    Postgres {
        /// Full libpq-style connection string, including credentials:
        /// `postgres://user:pass@host:port/dbname`.
        url: String,
    },
}

impl DbProfile {
    pub fn kind(&self) -> DbKind {
        match self {
            DbProfile::Local { .. } => DbKind::Local,
            DbProfile::Turso { .. } => DbKind::Turso,
            DbProfile::Postgres { .. } => DbKind::Postgres,
        }
    }

    /// Local filesystem path of the database, when there is one. Postgres has
    /// no local file — returns the empty string, which `open` treats as "no
    /// directory to create".
    pub fn path(&self) -> &str {
        match self {
            DbProfile::Local { path } | DbProfile::Turso { path, .. } => path,
            DbProfile::Postgres { .. } => "",
        }
    }

    /// The remote URL the profile points at, if any. Shown to the frontend
    /// (no secrets stripped — a Postgres URL's credentials are handled at the
    /// storage layer, never round-tripped through `DbDescriptor`).
    pub fn remote_url(&self) -> Option<&str> {
        match self {
            DbProfile::Turso { url, .. } | DbProfile::Postgres { url } => Some(url),
            DbProfile::Local { .. } => None,
        }
    }
}

/// What the active profile supports. The frontend reads this to hide actions
/// that can't work rather than letting them fail at click time.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCaps {
    /// `VACUUM INTO` backup export. True only for a local SQLite file.
    pub export: bool,
    /// Whether `db_switch_path` can repoint this profile at another file.
    pub switch_path: bool,
    /// Whether an explicit pull-from-primary is meaningful. Always false now
    /// (no replica path); kept for the frontend's existing UI gating.
    pub sync: bool,
    /// Whether writes are accepted. Always true for live profiles (the old
    /// read-only degraded-replica mode is gone with the replica path).
    pub writable: bool,
    /// Whether `VACUUM` is meaningful. Local SQLite only.
    pub vacuum: bool,
}

/// The profile as the frontend sees it — no secrets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbDescriptor {
    pub kind: DbKind,
    pub path: String,
    pub remote_url: Option<String>,
    pub caps: DbCaps,
}

/// The live database. Holds a SeaORM-backed [`Conn`] and the descriptor the
/// frontend reads. There is no separate "database" handle to keep alive the
/// way the libsql embedded replica needed — a SeaORM `DatabaseConnection` is
/// an `Arc`-around-a-pool, so cloning it out per command is cheap and keeps
/// the pool (and any open transaction) alive for as long as any clone exists.
pub struct Db {
    conn: Conn,
    descriptor: DbDescriptor,
}

impl Db {
    /// Cheap: clones the underlying `Arc<Pool>` and returns a fresh `Conn`.
    /// Callers move it out from under the state mutex and `.await` on their
    /// own copy — the reason the mutex is `std::sync::Mutex` and never held
    /// across a suspend point.
    pub fn conn(&self) -> Conn {
        self.conn.clone_handle()
    }

    pub fn descriptor(&self) -> DbDescriptor {
        self.descriptor.clone()
    }

    pub fn path(&self) -> &str {
        &self.descriptor.path
    }

    pub fn kind(&self) -> DbKind {
        self.descriptor.kind
    }

    pub fn backend(&self) -> sea_orm::DbBackend {
        self.conn.backend()
    }
}

/// Opens `profile` and brings the schema up to date.
///
/// `token` is accepted for signature compatibility with the old Turso flow but
/// is no longer used: a Postgres connection string carries its own credentials,
/// and the Turso variant is refused outright.
pub async fn open(profile: &DbProfile, _token: Option<&str>) -> Result<Db, String> {
    // A local file gets its parent directory created; `:memory:` (tests),
    // a bare filename, and Postgres (no local file) have nothing to create.
    if let Some(parent) = std::path::Path::new(profile.path())
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let schema_started = std::time::Instant::now();
    let (conn, caps) = match profile {
        DbProfile::Local { path } => {
            // A pool of `:memory:` connections is N separate empty databases.
            // Force a single connection so the schema applied at open is the
            // same in-memory DB every later command sees (tests rely on this).
            // A file path becomes a `sqlite://<path>?mode=rwc` URL (rwc so a
            // missing file is created, matching libsql's `Builder::new_local`).
            let mut opts = sea_orm::ConnectOptions::new(if path == ":memory:" {
                "sqlite::memory:".to_string()
            } else {
                format!("sqlite://{path}?mode=rwc")
            });
            if path == ":memory:" {
                opts.max_connections(1).min_connections(1);
            }
            let url = sea_orm::Database::connect(opts)
                .await
                .map_err(|e| format!("Failed to open local database: {e}"))?;
            (
                Conn::new_db(url, DbKind::Local),
                DbCaps { export: true, switch_path: true, sync: false, writable: true, vacuum: true },
            )
        }
        DbProfile::Postgres { url } => {
            let db = sea_orm::Database::connect(url.clone())
                .await
                .map_err(|e| format!("Failed to connect to Postgres: {e}"))?;
            (
                Conn::new_db(db, DbKind::Postgres),
                DbCaps { export: false, switch_path: false, sync: false, writable: true, vacuum: false },
            )
        }
        DbProfile::Turso { .. } => {
            return Err(
                "The Turso embedded-replica backend was removed in the SeaORM \
                 migration. Use a Postgres connection string instead."
                    .to_string(),
            );
        }
    };

    apply_pragmas(&conn).await;
    super::init_db(&conn)
        .await
        .map_err(|e| format!("Failed to initialize database: {e}"))?;
    eprintln!("[startup] database-schema-ready +{}ms", schema_started.elapsed().as_millis());

    Ok(Db {
        conn,
        descriptor: DbDescriptor {
            kind: profile.kind(),
            path: profile.path().to_string(),
            remote_url: profile.remote_url().map(str::to_string),
            caps,
        },
    })
}

/// A throwaway in-memory database with the full schema applied — for tests and
/// smoke checks that need an `AppState` without touching the user's data.
pub async fn open_memory() -> Result<Db, String> {
    open(&DbProfile::Local { path: ":memory:".to_string() }, None).await
}

/// A *blank* in-memory SQLite `Conn` with no `init_db` pass — for tests that
/// seed the schema themselves (the migration tests, the backend-parity test).
/// Hidden because it's a test seam, not part of the app's connection surface.
#[doc(hidden)]
pub async fn open_blank_memory() -> Result<Conn, String> {
    use sea_orm::ConnectionTrait;
    let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
    opts.max_connections(1).min_connections(1);
    let db = sea_orm::Database::connect(opts)
        .await
        .map_err(|e| e.to_string())?;
    let _ = db.execute_unprepared("PRAGMA foreign_keys=ON;").await;
    Ok(Conn::new_db(db, DbKind::Local))
}

/// Wrap a raw SeaORM Postgres pool as a `Conn` — test seam for the
/// backend-parity test, which needs to point at an already-running Postgres
/// without going through the full `open()` (which would run `init_db`).
#[doc(hidden)]
pub async fn open_blank_postgres(url: &str) -> Result<Conn, String> {
    let db = sea_orm::Database::connect(url.to_string())
        .await
        .map_err(|e| e.to_string())?;
    Ok(Conn::new_db(db, DbKind::Postgres))
}

/// Conn PRAGMAs are advisory and SQLite-only: `journal_mode=WAL` for
/// concurrency across the pool, `foreign_keys=ON` for cascade behaviour. Both
/// are no-ops on Postgres (which has no PRAGMAs and enables FKs per-relation).
pub(crate) async fn apply_pragmas(conn: &Conn) {
    if conn.kind() == DbKind::Local {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").await;
    }
}
