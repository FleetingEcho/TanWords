//! Per-user runtime pool.
//!
//! Every active web user gets their own core runtime — a `Registry` +
//! `AppHandle` pair built around *their* database (per-user local file, or
//! their self-provisioned Postgres database when they've enabled it). That's
//! the whole multi-user trick: command code keeps reading `State<AppState>`
//! exactly as on desktop, and isolation (data, document-privacy unlocks, SSE
//! events) comes from the runtimes being separate objects.
//!
//! Capacity is deliberately small. Evicting an entry drops the last `Arc`,
//! which drops the Registry, which drops the `Db` — closing a local file or a
//! Postgres pool is cheap; nothing is lost (a fresh connection is opened on
//! next spawn).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tanwords_lib::rpc::Ctx;
use tanwords_lib::shim::AppHandle;

use crate::users::UsersDb;

/// Ceiling on concurrently-held runtimes. Beyond it we evict idle entries —
/// this is a self-hosted app for invited users, not a public service.
const MAX_RUNTIMES: usize = 8;
/// An entry unused for this long is evictable even under pressure.
const IDLE_EVICT_SECS: u64 = 15 * 60;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub struct UserRuntime {
    pub ctx: Ctx,
    /// Exposed for the per-user SSE channel: `rt.app.subscribe()`.
    pub app: AppHandle,
}

struct RuntimeEntry {
    runtime: Arc<UserRuntime>,
    last_used: AtomicU64,
}

pub struct RuntimePool {
    users: Arc<UsersDb>,
    data_dir: PathBuf,
    /// Host/port of the shared `postgres` service — used to build a saved
    /// Postgres profile's connection URL at runtime spawn.
    postgres_host: String,
    postgres_port: u16,
    entries: Mutex<HashMap<i64, RuntimeEntry>>,
    /// Serializes spawns so two first-requests from the same user/devices
    /// never open the same database twice. Keyed per user: a global gate
    /// meant one user's unreachable Postgres endpoint (sqlx's default 30s
    /// connect timeout) held the gate and queued every *other* user's first
    /// request behind it. Entries persist for the process lifetime — a few
    /// dozen bytes per user, and removing them on completion would let two
    /// in-flight spawners race on different gate Arcs.
    spawn_gates: Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>,
}

impl RuntimePool {
    pub fn new(users: Arc<UsersDb>, data_dir: PathBuf, postgres_host: String, postgres_port: u16) -> Self {
        Self {
            users,
            data_dir,
            postgres_host,
            postgres_port,
            entries: Mutex::new(HashMap::new()),
            spawn_gates: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn user_dir(&self, user_id: i64) -> PathBuf {
        self.data_dir.join("users").join(user_id.to_string())
    }

    /// The credential store — the ntfy scheduler walks its user list each
    /// pass (see `server/ntfy.rs`).
    pub(crate) fn users(&self) -> &Arc<UsersDb> {
        &self.users
    }

    pub async fn runtime_for(&self, user_id: i64) -> Result<Arc<UserRuntime>, String> {
        // Fast path: already spawned.
        {
            let entries = self.entries.lock().map_err(|e| e.to_string())?;
            if let Some(entry) = entries.get(&user_id) {
                entry.last_used.store(now_secs(), Ordering::Relaxed);
                return Ok(entry.runtime.clone());
            }
        }

        // Take this user's gate before awaiting anything: the std mutex on
        // the gate map is released immediately, so other users' lookups
        // never block behind a slow spawn.
        let gate = {
            let mut gates = self.spawn_gates.lock().map_err(|e| e.to_string())?;
            gates
                .entry(user_id)
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _gate = gate.lock().await;

        // Re-check under the spawn gate.
        {
            let entries = self.entries.lock().map_err(|e| e.to_string())?;
            if let Some(entry) = entries.get(&user_id) {
                entry.last_used.store(now_secs(), Ordering::Relaxed);
                return Ok(entry.runtime.clone());
            }
        }

        let user_dir = self.user_dir(user_id);
        let postgres = self.users.active_postgres_for(user_id).await?;
        let postgres_url = postgres
            .as_ref()
            .map(|p| format!("postgres://{}:{}@{}:{}/{}?sslmode=require", p.role, p.password, self.postgres_host, self.postgres_port, p.db_name));
        // A saved Postgres profile that can't be opened (endpoint unreachable,
        // rotated password) must not lock the account out of the app: fall
        // back to the per-user local database and surface the failure
        // through the same startup-warning channel the desktop uses.
        let (database, db_fallback_warning) = match tanwords_lib::open_user_db(&user_dir, postgres_url.clone()).await {
            Ok(db) => (db, None),
            Err(e) if postgres_url.is_some() => {
                eprintln!("[tanwords-web] user {user_id}: Postgres open failed; falling back to local db: {e}");
                let db = tanwords_lib::open_user_db(&user_dir, None).await?;
                (db, Some("Postgres".to_string()))
            }
            Err(e) => return Err(e),
        };
        let (registry, app) = tanwords_lib::build_state_for(database, db_fallback_warning).await;
        let runtime = Arc::new(UserRuntime {
            ctx: Ctx::new(registry, app.clone()),
            app,
        });

        let mut entries = self.entries.lock().map_err(|e| e.to_string())?;
        if entries.len() >= MAX_RUNTIMES {
            let now = now_secs();
            // Prefer idle entries; if all are hot, evict the coldest one anyway.
            let candidate = entries
                .iter()
                .filter(|(_, e)| now.saturating_sub(e.last_used.load(Ordering::Relaxed)) > IDLE_EVICT_SECS)
                .max_by_key(|(_, e)| now.saturating_sub(e.last_used.load(Ordering::Relaxed)))
                .map(|(id, _)| *id)
                .or_else(|| {
                    entries
                        .iter()
                        .min_by_key(|(_, e)| e.last_used.load(Ordering::Relaxed))
                        .map(|(id, _)| *id)
                });
            if let Some(id) = candidate {
                entries.remove(&id);
            }
        }
        entries.insert(
            user_id,
            RuntimeEntry {
                runtime: runtime.clone(),
                last_used: AtomicU64::new(now_secs()),
            },
        );
        Ok(runtime)
    }

}
