//! Per-user runtime pool.
//!
//! Every active web user gets their own core runtime — a `Registry` +
//! `AppHandle` pair built around *their* database (per-user local file, or
//! their Turso embedded replica when they've connected one). That's the whole
//! multi-user trick: command code keeps reading `State<AppState>` exactly as
//! on desktop, and isolation (data, document-privacy unlocks, SSE events)
//! comes from the runtimes being separate objects.
//!
//! Capacity is deliberately small. Evicting an entry drops the last `Arc`,
//! which drops the Registry, which drops the `Db` — closing a local file is
//! nothing, and a Turso replica just stops its background sync; nothing is
//! lost (the replica re-syncs from the primary on next spawn).

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
    entries: Mutex<HashMap<i64, RuntimeEntry>>,
    /// Serializes spawns so two first-requests from the same user/devices
    /// never open the same replica file twice.
    spawn_gate: tokio::sync::Mutex<()>,
}

impl RuntimePool {
    pub fn new(users: Arc<UsersDb>, data_dir: PathBuf) -> Self {
        Self {
            users,
            data_dir,
            entries: Mutex::new(HashMap::new()),
            spawn_gate: tokio::sync::Mutex::new(()),
        }
    }

    pub(crate) fn user_dir(&self, user_id: i64) -> PathBuf {
        self.data_dir.join("users").join(user_id.to_string())
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

        let _gate = self.spawn_gate.lock().await;

        // Re-check under the spawn gate.
        {
            let entries = self.entries.lock().map_err(|e| e.to_string())?;
            if let Some(entry) = entries.get(&user_id) {
                entry.last_used.store(now_secs(), Ordering::Relaxed);
                return Ok(entry.runtime.clone());
            }
        }

        let user_dir = self.user_dir(user_id);
        let turso = self
            .users
            .turso_for(user_id)
            .await?
            .map(|p| (p.url.clone(), p.token));
        // A saved Turso profile that can't be opened (primary unreachable,
        // revoked token) must not lock the account out of the app: fall back
        // to the per-user local database and surface the failure through the
        // same startup-warning channel the desktop uses.
        let (database, db_fallback_warning) = match tanwords_lib::open_user_db(&user_dir, turso.clone()).await {
            Ok(db) => (db, None),
            Err(e) if turso.is_some() => {
                eprintln!("[tanwords-web] user {user_id}: Turso open failed; falling back to local db: {e}");
                let db = tanwords_lib::open_user_db(&user_dir, None).await?;
                let url = turso.map(|(u, _)| u).unwrap_or_default();
                (db, Some(url))
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

    /// A Turso connect/reconnect must open a fresh replica (see the
    /// stale-lineage comment in core `db_connect_turso`), so callers wipe +
    /// respawn rather than swap in place.
    pub fn drop_runtime(&self, user_id: i64) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(&user_id);
        }
    }
}
