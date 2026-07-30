//! Where the database actually lives, and how the rest of the app gets at it.
//!
//! Two profiles, one API. `Local` is a plain SQLite file, exactly as before.
//! `Turso` is a libsql *embedded replica*: still a real local SQLite file
//! (so reads stay local-speed and FTS5/transactions/backup all behave), with
//! writes forwarded to the user's Turso primary and changes synced back down.
//! Everything downstream of `AppState::conn()` is identical between the two —
//! only the `Builder` call differs.

use libsql::{Builder, Connection, Database};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

/// How often an embedded replica pulls changes from the primary. Writes are
/// pushed immediately; this only bounds how stale another device's edits look.
const SYNC_INTERVAL: Duration = Duration::from_secs(60);

// Why writes are forwarded to the primary rather than queued locally:
//
// libsql also offers `Builder::new_synced_database`, which accepts writes
// offline and pushes them on sync. Measured against a real Turso database
// (2026-07), its conflict handling is not safe to build on yet:
//
//   * rejection is whole-database, not per-row — if the other device pushed
//     anything at all, the entire local batch is refused, including edits that
//     touch unrelated rows;
//   * the rejection is permanent. Retrying alternates between
//     `server returned a conflict: sent=N, got=N` and a 503 `database is
//     locked`, and never converges;
//   * the only recovery the API exposes is deleting the local file and
//     re-pulling, which silently discards every un-pushed edit.
//
// So a user editing offline while another device syncs would end up unable to
// sync at all, with "throw away everything you did offline" as the only way
// out. Forwarding writes means they simply fail while offline, which is a far
// better failure than losing them. Revisit if libsql grows a rebase path.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Local,
    Turso,
}

/// A saved connection profile. The token is *not* part of this — it lives in
/// the OS keychain (see `secrets`), so the profile itself is safe to write to
/// a plain config file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DbProfile {
    Local {
        path: String,
    },
    Turso {
        /// Local replica file. Content mirrors the primary and is safe to
        /// delete (it re-syncs from scratch), so it lives beside the default
        /// DB rather than wherever the user's local profile points.
        path: String,
        url: String,
    },
}

impl DbProfile {
    pub fn kind(&self) -> DbKind {
        match self {
            DbProfile::Local { .. } => DbKind::Local,
            DbProfile::Turso { .. } => DbKind::Turso,
        }
    }

    pub fn path(&self) -> &str {
        match self {
            DbProfile::Local { path } | DbProfile::Turso { path, .. } => path,
        }
    }
}

/// What the active profile supports. The frontend reads this to hide actions
/// that can't work rather than letting them fail at click time.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCaps {
    /// `VACUUM INTO` backup export. True for Turso too — the replica is a real
    /// local SQLite file, so exporting it works exactly like a local database;
    /// the frontend labels it as a snapshot of the replica (possibly a few
    /// seconds behind the primary) rather than a live guarantee.
    pub export: bool,
    /// Whether `db_switch_path` can repoint this profile at another file.
    pub switch_path: bool,
    /// Whether an explicit pull-from-primary is meaningful.
    pub sync: bool,
    /// False in the degraded offline mode below — the replica is opened
    /// read-only there, so the UI should say so rather than let the user type
    /// into forms whose saves will fail.
    pub writable: bool,
}

/// The profile as the frontend sees it — no secrets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbDescriptor {
    pub kind: DbKind,
    pub path: String,
    pub remote_url: Option<String>,
    pub caps: DbCaps,
    /// A Turso profile serving its local replica because the primary couldn't
    /// be reached. Reads are the user's real (possibly stale) data; writes are
    /// refused until a later launch reconnects.
    pub offline: bool,
}

/// The live database. Holds the `Database` alongside the `Connection` because
/// dropping the former tears down an embedded replica's background sync — the
/// connection alone is not enough to keep a Turso profile alive.
pub struct Db {
    /// `Arc` so `sync()` can be handed an owned handle to await on *after* the
    /// state mutex is released, rather than borrowing across the lock.
    database: Arc<Database>,
    conn: Connection,
    descriptor: DbDescriptor,
}

impl Db {
    /// Cheap: `libsql::Connection` is an Arc handle. Callers clone it out from
    /// under the state mutex and then `.await` freely on their own copy —
    /// which is the whole reason the mutex is a `std::sync::Mutex` and never
    /// held across a suspend point.
    pub fn conn(&self) -> Connection {
        self.conn.clone()
    }

    pub fn descriptor(&self) -> DbDescriptor {
        self.descriptor.clone()
    }

    /// The database handle itself, for opening *additional* connections.
    /// Interactive transactions must run on their own connection: on a Turso
    /// profile every clone of `conn` is the same Hrana stream, and a
    /// transaction pins that stream into Txn state — any concurrent command
    /// sharing it then fails with "connection has reached an invalid state,
    /// started with Txn" / "Stream already in use".
    pub fn database(&self) -> Arc<Database> {
        self.database.clone()
    }

    pub fn path(&self) -> &str {
        &self.descriptor.path
    }

    pub fn kind(&self) -> DbKind {
        self.descriptor.kind
    }

    /// An owned handle for `sync_handle` to await on once the caller has let
    /// go of the state lock. Local profiles have nothing to sync.
    pub fn sync_handle(&self) -> Option<Arc<Database>> {
        match self.descriptor.kind {
            DbKind::Local => None,
            DbKind::Turso => Some(self.database.clone()),
        }
    }
}

/// Opens `profile` and brings the schema up to date.
///
/// `token` is required for (and only used by) Turso profiles; it is passed in
/// separately rather than living on `DbProfile` so it never lands in config.
pub async fn open(profile: &DbProfile, token: Option<&str>) -> Result<Db, String> {
    // `:memory:` (tests) has no parent directory to create, and neither does a
    // bare filename in the current directory.
    if let Some(parent) = std::path::Path::new(profile.path())
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut offline = false;
    let (database, caps) = match profile {
        DbProfile::Local { path } => {
            let db = Builder::new_local(path)
                .build()
                .await
                .map_err(|e| format!("Failed to open local database: {e}"))?;
            (db, DbCaps { export: true, switch_path: true, sync: false, writable: true })
        }
        DbProfile::Turso { path, url } => {
            let token = token
                .filter(|t| !t.trim().is_empty())
                .ok_or_else(|| "Missing Turso auth token".to_string())?;
            // Whether we already hold a copy of the data decides how bad a
            // failed first sync is, so check before `build()` creates the file.
            let has_replica = std::path::Path::new(path).exists();
            let built = Builder::new_remote_replica(path.clone(), url.clone(), token.to_string())
                .sync_interval(SYNC_INTERVAL)
                .build()
                .await;

            // `build()` contacts the primary, so being offline fails here, not
            // at the explicit sync below.
            let db = match built {
                Ok(db) => db,
                Err(error) if has_replica => {
                    return open_degraded(profile, path, &error.to_string()).await;
                }
                Err(error) => return Err(format!("Failed to connect to Turso: {error}")),
            };

            // Pull once before first use so a fresh replica isn't briefly empty.
            if let Err(error) = db.sync().await {
                if !has_replica {
                    // Nothing local to fall back on — failing here is far better
                    // than handing back an empty database that looks like data
                    // loss.
                    return Err(format!("Initial sync failed: {error}"));
                }
                // Reachable enough to connect but not to sync. The replica is a
                // full local copy, so keep serving it (possibly stale) and let
                // the background interval catch up.
                eprintln!("[tanwords] Turso sync failed ({error}); serving the local replica");
                offline = true;
            }
            (db, DbCaps { export: true, switch_path: false, sync: true, writable: true })
        }
    };

    let conn = database.connect().map_err(|e| e.to_string())?;
    apply_pragmas(&conn, profile.kind()).await;
    super::init_db(&conn).await.map_err(|e| format!("Failed to initialize database: {e}"))?;

    Ok(Db {
        database: Arc::new(database),
        conn,
        descriptor: DbDescriptor {
            kind: profile.kind(),
            path: profile.path().to_string(),
            remote_url: match profile {
                DbProfile::Turso { url, .. } => Some(url.clone()),
                DbProfile::Local { .. } => None,
            },
            caps,
            offline,
        },
    })
}

/// The primary is unreachable but a replica file is already on disk. Serve it
/// as a plain local database so the user still sees their vocabulary instead of
/// an empty one.
///
/// Opened **read-only** deliberately: writes into a replica file behind the
/// sync layer's back are the kind of thing that resurfaces later as a frame
/// conflict or a corrupt local image. Failing the write with a clear error now
/// is much better than losing it (or the whole file) at the next sync.
async fn open_degraded(profile: &DbProfile, path: &str, reason: &str) -> Result<Db, String> {
    eprintln!("[tanwords] Turso unreachable ({reason}); opening the replica read-only");
    let database = Builder::new_local(path)
        .flags(libsql::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .build()
        .await
        .map_err(|e| format!("Failed to open local replica offline: {e}"))?;
    let conn = database.connect().map_err(|e| e.to_string())?;

    // `build()` creates the replica file before it contacts the primary, so a
    // connect that failed on its very first attempt leaves an empty file behind.
    // That file then makes every later attempt look like "we have a replica to
    // fall back on" — and this function would hand back a database with no
    // schema that also can't be written to, which reads as a successful
    // connection to an empty vocabulary. Only fall back to a replica that
    // actually holds something; otherwise report the real failure.
    let objects = super::scalar_i64(&conn, "SELECT COUNT(*) FROM sqlite_master", ()).await?;
    if objects == 0 {
        return Err(format!("Failed to connect to Turso: {reason}"));
    }

    Ok(Db {
        database: Arc::new(database),
        conn,
        descriptor: DbDescriptor {
            kind: DbKind::Turso,
            path: path.to_string(),
            remote_url: match profile {
                DbProfile::Turso { url, .. } => Some(url.clone()),
                DbProfile::Local { .. } => None,
            },
            caps: DbCaps { export: true, switch_path: false, sync: false, writable: false },
            offline: true,
        },
    })
}

/// A throwaway in-memory database with the full schema applied — for tests and
/// smoke checks that need an `AppState` without touching the user's data.
pub async fn open_memory() -> Result<Db, String> {
    open(&DbProfile::Local { path: ":memory:".to_string() }, None).await
}

/// Connection PRAGMAs are advisory: a replica manages its own journal, and
/// rejecting the statement there is expected rather than an error worth
/// failing startup over.
pub(crate) async fn apply_pragmas(conn: &Connection, kind: DbKind) {
    if kind == DbKind::Local {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;").await;
    }
    let _ = conn.execute_batch("PRAGMA foreign_keys=ON;").await;
}
