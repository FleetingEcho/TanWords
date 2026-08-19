//! Per-user remote database profiles, split out of the parent `users`
//! module for file size: the user's remembered Turso connection (an
//! external or self-hosted target the user supplies) and the per-user
//! dedicated sqld container the server itself provisions. These are
//! inherent methods on `super::UsersDb`; they stay reachable as
//! `users::UsersDb::<method>` unchanged because inherent `pub` methods
//! resolve through the type regardless of which module holds the impl
//! block.

use base64::Engine;
use sea_orm::ConnectionTrait;

use super::{IntoSqValue, SqldRemoteProfile, TursoProfile, stmt};

impl super::UsersDb {
    /// The user's remembered Turso profile, independent of which database is
    /// currently selected.
    pub async fn turso_for(&self, user_id: i64) -> Result<Option<TursoProfile>, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT turso_url, turso_token_enc FROM users WHERE id = ?",
                [user_id.into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let Some(r) = row else {
            return Ok(None);
        };
        let url = r
            .try_get_by_index::<Option<String>>(0)
            .map_err(|e| e.to_string())?;
        let enc = r
            .try_get_by_index::<Option<String>>(1)
            .map_err(|e| e.to_string())?;
        match (url, enc) {
            (Some(url), Some(enc)) => {
                let token = self
                    .unseal(&enc)
                    .ok_or_else(|| "stored Turso token failed to decrypt (master key changed?)".to_string())?;
                Ok(Some(TursoProfile { url, token }))
            }
            _ => Ok(None),
        }
    }

    pub async fn active_turso_for(&self, user_id: i64) -> Result<Option<TursoProfile>, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT active_db FROM users WHERE id = ?",
                [user_id.into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let active = row
            .and_then(|r| {
                r.try_get_by_index::<Option<String>>(0)
                    .ok()
                    .flatten()
            })
            .unwrap_or_else(|| "local".to_string());
        drop(conn);
        if active == "turso" {
            self.turso_for(user_id).await
        } else {
            Ok(None)
        }
    }

    pub async fn set_active_db(&self, user_id: i64, source: &str) -> Result<(), String> {
        if source != "local" && source != "turso" {
            return Err("database source must be `local` or `turso`".to_string());
        }
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET active_db = ? WHERE id = ?",
            [source.into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn set_turso(&self, user_id: i64, url: &str, token: &str) -> Result<(), String> {
        let enc = self.seal(token);
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET turso_url = ?, turso_token_enc = ?, active_db = 'turso' WHERE id = ?",
            [url.into_sq(), enc.into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn clear_turso(&self, user_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET turso_url = NULL, turso_token_enc = NULL, active_db = 'local' WHERE id = ?",
            [user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Mirrors the core's RememberedTursoConnection shape (never the token).
    pub async fn remembered_turso(&self, user_id: i64) -> Result<(Option<String>, bool), String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT turso_url, turso_token_enc FROM users WHERE id = ?",
                [user_id.into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let Some(r) = row else {
            return Ok((None, false));
        };
        let url = r
            .try_get_by_index::<Option<String>>(0)
            .map_err(|e| e.to_string())?;
        let has_token = r
            .try_get_by_index::<Option<String>>(1)
            .map_err(|e| e.to_string())?
            .is_some();
        Ok((url, has_token))
    }

    // ── Per-user dedicated sqld container ──────────────────────────────────

    /// This user's provisioned sqld slot, if they've ever enabled remote
    /// access — `enabled` distinguishes "provisioned and running" from
    /// "provisioned, currently disabled" (the container itself may be
    /// stopped, but the port/keypair/data are kept so re-enabling is cheap).
    pub async fn sqld_remote_for(&self, user_id: i64) -> Result<Option<SqldRemoteProfile>, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT sqld_port, sqld_key_enc, sqld_enabled FROM users WHERE id = ?",
                [user_id.into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let Some(r) = row else {
            return Ok(None);
        };
        let port = r
            .try_get_by_index::<Option<i64>>(0)
            .map_err(|e| e.to_string())?;
        let enc = r
            .try_get_by_index::<Option<String>>(1)
            .map_err(|e| e.to_string())?;
        let enabled = r
            .try_get_by_index::<i64>(2)
            .map_err(|e| e.to_string())?
            != 0;
        match (port, enc) {
            (Some(port), Some(enc)) => {
                let key_b64 = self
                    .unseal(&enc)
                    .ok_or_else(|| "stored sqld key failed to decrypt (master key changed?)".to_string())?;
                let key_der = base64::engine::general_purpose::STANDARD
                    .decode(key_b64)
                    .map_err(|e| e.to_string())?;
                Ok(Some(SqldRemoteProfile { port, key_der, enabled }))
            }
            _ => Ok(None),
        }
    }

    /// Every port already claimed by some user's sqld slot, so the caller can
    /// pick the first free one in the pre-opened range.
    pub async fn used_sqld_ports(&self) -> Result<Vec<i64>, String> {
        let conn = self.conn.lock().await;
        let rows = conn
            .query_all_raw(stmt("SELECT sqld_port FROM users WHERE sqld_port IS NOT NULL", []))
            .await
            .map_err(|e| e.to_string())?;
        let mut ports = Vec::new();
        for r in rows {
            ports.push(
                r.try_get_by_index::<i64>(0)
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(ports)
    }

    /// First-time provisioning or a key rotation: `port` only changes on
    /// first-time provisioning (rotation re-uses the existing one — the
    /// caller is responsible for passing the existing port back in that
    /// case). Always leaves the slot `enabled`.
    pub async fn set_sqld_remote(&self, user_id: i64, port: i64, key_der: &[u8]) -> Result<(), String> {
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key_der);
        let enc = self.seal(&key_b64);
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET sqld_port = ?, sqld_key_enc = ?, sqld_enabled = 1 WHERE id = ?",
            [port.into_sq(), enc.into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// `(user_id, port)` for every currently-enabled sqld slot — what the
    /// Caddy config needs to route every active user's port to their
    /// container, recomputed fresh on every enable/rotate/disable rather
    /// than tracked incrementally.
    pub async fn enabled_sqld_routes(&self) -> Result<Vec<(i64, i64)>, String> {
        let conn = self.conn.lock().await;
        let rows = conn
            .query_all_raw(stmt(
                "SELECT id, sqld_port FROM users WHERE sqld_enabled = 1 AND sqld_port IS NOT NULL",
                [],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let mut routes = Vec::new();
        for r in rows {
            routes.push((
                r.try_get_by_index::<i64>(0).map_err(|e| e.to_string())?,
                r.try_get_by_index::<i64>(1).map_err(|e| e.to_string())?,
            ));
        }
        Ok(routes)
    }

    /// Toggles the enabled flag without touching the port/keypair — the
    /// container and its data volume are meant to be stopped, not removed,
    /// so re-enabling later doesn't provision a second one.
    pub async fn set_sqld_enabled(&self, user_id: i64, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET sqld_enabled = ? WHERE id = ?",
            [(enabled as i64).into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
