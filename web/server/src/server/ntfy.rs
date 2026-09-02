//! The ntfy reminder scheduler — the always-online half of the feature.
//!
//! The web server is the one process guaranteed to be running when a
//! reminder comes due (the desktop app opens and closes; the server does
//! not), so it owns the job. One task, spawned at startup, walks every
//! user's runtime every 30 seconds and runs `tanwords_lib::ntfy::tick`
//! against their database — per-user config, per-user events, no
//! cross-user bleed. The desktop build deliberately runs no scheduler of
//! its own: two senders over one shared database would mean duplicate
//! pushes (the `reminder_sent_at` claim in the core narrows that race but
//! was never meant to make two schedlers a design).
//!
//! The tick itself is one settings read plus one calendar query per user —
//! cheap enough that skipping the "is anyone configured?" pre-check is
//! simpler than caching it.

use std::sync::Arc;
use std::time::Duration;

use crate::runtime::RuntimePool;

/// How often each user's reminders are checked. The value trades push
/// latency (worst case one period late) against idle database traffic;
/// 30s keeps a "remind me 30 minutes before" push within the same minute
/// it became due in practice.
const TICK_PERIOD: Duration = Duration::from_secs(30);

/// Spawns the scheduler. Called once from `serve()`, after the listener is
/// bound — a server that failed to start must not push anything.
pub fn spawn_ntfy_scheduler(pool: Arc<RuntimePool>) {
    tokio::spawn(async move {
        // `interval` fires immediately on the first tick, which is what a
        // restart wants: reminders that came due while the server was down
        // are caught up on the first pass (the core's send window tolerates
        // lateness up to the event's start).
        let mut ticker = tokio::time::interval(TICK_PERIOD);
        // A slow or paused runtime (e.g. a wedged Postgres endpoint) must
        // not make the ticks queue up behind it — skip missed passes.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(e) = one_pass(&pool).await {
                eprintln!("[tanwords-web] ntfy scheduler pass failed: {e}");
            }
        }
    });
}

/// One pass over every user. Per-user failures are logged inside `tick` and
/// never abort the pass — one user's unreachable ntfy server must not stop
/// another user's reminder from firing.
async fn one_pass(pool: &Arc<RuntimePool>) -> Result<(), String> {
    let user_ids = pool.users().list_user_ids().await?;
    for user_id in user_ids {
        // `runtime_for` spawns (and caches) the user's runtime on first
        // sight — the same path a login takes, so the scheduler never opens
        // a database behind the pool's back.
        let runtime = match pool.runtime_for(user_id).await {
            Ok(runtime) => runtime,
            Err(e) => {
                eprintln!("[tanwords-web] ntfy: could not open user {user_id}'s runtime: {e}");
                continue;
            }
        };
        let state = match runtime.app.try_state::<tanwords_lib::AppState>() {
            Some(state) => state,
            None => continue,
        };
        let conn = match tanwords_lib::db::conn(&state) {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("[tanwords-web] ntfy: user {user_id}: no database handle: {e}");
                continue;
            }
        };
        // The State borrow ends here; `conn` is an owned handle.
        drop(state);
        if let Err(e) = tanwords_lib::ntfy::tick(&conn).await {
            eprintln!("[tanwords-web] ntfy: user {user_id}: reminder pass failed: {e}");
        }
    }
    Ok(())
}
