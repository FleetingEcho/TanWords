//! Per-user Postgres remote-access profile, split out of the parent `users`
//! module for file size: the role/database the server self-provisions inside
//! the shared `postgres` service (Settings > Cloud tab > Postgres) when a
//! user turns it on. These are inherent methods on `super::UsersDb`; they
//! stay reachable as `users::UsersDb::<method>` unchanged because inherent
//! `pub` methods resolve through the type regardless of which module holds
//! the impl block.

use sea_orm::ConnectionTrait;

use super::{IntoSqValue, PostgresRemoteProfile, stmt};

impl super::UsersDb {
    /// This user's provisioned Postgres role/database, if they've ever
    /// enabled remote access — `enabled` distinguishes "provisioned and
    /// logged-in-able" from "provisioned, currently disabled" (the role is
    /// kept with `NOLOGIN` and the database is kept, so re-enabling is cheap).
    pub async fn postgres_remote_for(&self, user_id: i64) -> Result<Option<PostgresRemoteProfile>, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_one_raw(stmt(
                "SELECT postgres_role, postgres_db_name, postgres_password_enc, postgres_enabled FROM users WHERE id = ?",
                [user_id.into_sq()],
            ))
            .await
            .map_err(|e| e.to_string())?;
        let Some(r) = row else {
            return Ok(None);
        };
        let role = r
            .try_get_by_index::<Option<String>>(0)
            .map_err(|e| e.to_string())?;
        let db_name = r
            .try_get_by_index::<Option<String>>(1)
            .map_err(|e| e.to_string())?;
        let enc = r
            .try_get_by_index::<Option<String>>(2)
            .map_err(|e| e.to_string())?;
        let enabled = r
            .try_get_by_index::<i64>(3)
            .map_err(|e| e.to_string())?
            != 0;
        match (role, db_name, enc) {
            (Some(role), Some(db_name), Some(enc)) => {
                let password = self
                    .unseal(&enc)
                    .ok_or_else(|| "stored Postgres password failed to decrypt (master key changed?)".to_string())?;
                Ok(Some(PostgresRemoteProfile { role, db_name, password, enabled }))
            }
            _ => Ok(None),
        }
    }

    /// First-time provisioning: `role`/`db_name` are fixed for the life of
    /// the account (see `postgres_remote::role_and_db_name`). Always leaves
    /// the profile `enabled`.
    pub async fn set_postgres_remote(&self, user_id: i64, role: &str, db_name: &str, password: &str) -> Result<(), String> {
        let enc = self.seal(password);
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET postgres_role = ?, postgres_db_name = ?, postgres_password_enc = ?, postgres_enabled = 1 WHERE id = ?",
            [role.into_sq(), db_name.into_sq(), enc.into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// A password rotation: role/database stay put, only the sealed
    /// credential changes.
    pub async fn set_postgres_password(&self, user_id: i64, password: &str) -> Result<(), String> {
        let enc = self.seal(password);
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET postgres_password_enc = ? WHERE id = ?",
            [enc.into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Toggles the enabled flag without touching the role/database/password —
    /// the role and its database are meant to have `LOGIN` revoked, not
    /// dropped, so re-enabling later doesn't provision a second one.
    pub async fn set_postgres_enabled(&self, user_id: i64, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute_raw(stmt(
            "UPDATE users SET postgres_enabled = ? WHERE id = ?",
            [(enabled as i64).into_sq(), user_id.into_sq()],
        ))
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn set_active_db(&self, user_id: i64, source: &str) -> Result<(), String> {
        if source != "local" && source != "postgres" {
            return Err("database source must be `local` or `postgres`".to_string());
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

    /// The Postgres profile to open at runtime startup, if this account's
    /// `active_db` is `postgres`. `None` if the account is on local storage.
    pub async fn active_postgres_for(&self, user_id: i64) -> Result<Option<PostgresRemoteProfile>, String> {
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
        if active == "postgres" {
            self.postgres_remote_for(user_id).await
        } else {
            Ok(None)
        }
    }
}
