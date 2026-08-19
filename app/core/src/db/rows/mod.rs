//! Row-fetching helpers + the connection newtype the rest of the crate talks to.
//!
//! Design goal: the ~180 existing call sites keep their shape. A SQL string, a
//! `params![..]` list, and a `|row|` mapper read with `row.get(N)?` — exactly as
//! they did under libsql — plus the same `.execute(..)` / `.query(..)` /
//! `.execute_batch(..)` / `.transaction()` / `.commit()` method-call surface on
//! the connection handle. Only the type behind all of that changes: a
//! [`sea_orm::DatabaseConnection`] (or a [`sea_orm::DatabaseTransaction`])
//! instead of a `libsql::Conn`.
//!
//! One query layer, two backends. Call sites write SQLite-flavoured SQL
//! (`?`/`?N` placeholders, `INSERT OR IGNORE`, `date('now')`) and this module
//! rewrites those to the Postgres-native form (`$N`, `ON CONFLICT DO NOTHING`,
//! `CURRENT_DATE`) only when the active backend is Postgres, so the same source
//! string runs against either database. The rewrites are deliberately narrow
//! and quote-aware; richer SQLite-only date arithmetic (`datetime('now', '+'
//! || ? || ' days')`, `date(?, '+1 day')`) is left untouched and ported
//! per-feature when that feature's batch is migrated to also target Postgres.

use sea_orm::{
    ConnectionTrait, DbBackend, DbErr, ExecResult, QueryResult, Statement, TransactionTrait,
    TryGetable,
};

use super::connection::DbKind;

// Postgres SQL-translation scanner + its unit tests. `Conn::build_stmt` calls
// into `translate::translate_for_pg` when the active backend is Postgres. The
// function is `pub(super)` so only this module reaches it — nothing outside
// `rows` calls it directly.
mod translate;

// ── re-exports so call sites `use crate::db::{params, Row, Value, …}` ──────────

pub use sea_orm::Value;

/// `Result<T, sea_orm::DbErr>` — the error type every helper and connection
/// method returns. SeaORM 2.0 ships `DbErr` but no `DbResult` alias, so this
/// stands in for the old `libsql::Result<T>` shape the call sites used.
pub type DbResult<T> = Result<T, DbErr>;

/// A single bound parameter value, or a vector of them. Re-exported so call
/// sites that built `Vec<crate::db::Value>` by hand now build `Vec<sea_orm::Value>`
/// through the same `Value::from(..)` shape.
pub type ParamVec = Vec<Value>;

// ── Row ──────────────────────────────────────────────────────────────────────

/// A query result row, wrapped so call sites keep the `row.get(N)?` shape they
/// had under libsql. `get` is generic over `T: TryGetable`, exactly the set of
/// types sea-orm can decode (i64, String, bool, f64, Option<T>, Vec<u8>, …),
/// so `row.get::<i64>(0)?` and the inferred `row.get(0)?` both work unchanged.
#[repr(transparent)]
pub struct Row(QueryResult);

impl Row {
    /// Read column `idx` by position. `None`-able columns are read as
    /// `row.get::<Option<String>>(N)?`, mirroring the libsql shape.
    pub fn get<T: TryGetable>(&self, idx: usize) -> Result<T, DbErr> {
        self.0.try_get_by_index(idx)
    }

    /// Read column `idx`, treating SQL NULL as the type's default/fallthrough.
    /// A few call sites used `row.get(N).unwrap_or_default()`; this keeps that.
    pub fn get_or_default<T: TryGetable + Default>(&self, idx: usize) -> T {
        self.0.try_get_by_index(idx).unwrap_or_default()
    }
}

impl std::ops::Deref for Row {
    type Target = QueryResult;
    fn deref(&self) -> &QueryResult {
        &self.0
    }
}

// ── params! + IntoParams ────────────────────────────────────────────────────

/// Anything a `fetch_*` / `execute` helper can accept as a parameter list.
/// Implemented for `()` (no params), `[T; N]` array literals, and `Vec<T>` —
/// the three shapes the codebase passes in — where `T: Into<Value>`.
pub trait IntoParams {
    fn into_params(self) -> ParamVec;
}

impl IntoParams for () {
    fn into_params(self) -> ParamVec {
        Vec::new()
    }
}

impl<T: Into<Value>> IntoParams for Vec<T> {
    fn into_params(self) -> ParamVec {
        self.into_iter().map(Into::into).collect()
    }
}

impl<T: Into<Value>, const N: usize> IntoParams for [T; N] {
    fn into_params(self) -> ParamVec {
        self.into_iter().map(Into::into).collect()
    }
}

/// The drop-in replacement for `crate::db::params![..]`. Produces a `Vec<Value>`,
/// so a call like `params![word.clone(), level]` binds a `String` and an
/// `Option<String>` exactly as before — `sea_orm::Value: From` covers the
/// common scalar/Option types the call sites use.
macro_rules! params {
    ( $( $v:expr ),* $(,)? ) => {
        vec![ $( $crate::db::rows::Value::from($v) ),* ]
    };
}
pub(crate) use params;

// ── Conn ─────────────────────────────────────────────────────────────────────

/// What a `Conn` is actually backed by. A pool connection for ordinary
/// commands, or a live transaction handle for the `db.transaction()` →
/// `tx.execute(..)` → `tx.commit()` blocks. Keeping both behind one type means
/// `fetch_optional(&tx, ..)` and `fetch_optional(&db, ..)` go through the same
/// helper — no separate transaction overload needed.
enum ConnInner {
    Db(sea_orm::DatabaseConnection),
    Txn(sea_orm::DatabaseTransaction),
}

/// The connection handle the rest of the crate holds and passes around.
/// Cheap to borrow, owned by `Db` and cloned out per command. Exposes the
/// libsql-shaped method surface (`.execute`, `.query`, `.execute_batch`,
/// `.transaction`, `.commit`) so existing call sites keep their syntax; each
/// method builds a translated [`Statement`] and delegates to sea-orm.
pub struct Conn {
    inner: ConnInner,
    backend: DbBackend,
    kind: DbKind,
}

impl Conn {
    /// Wrap a pool connection. The `Db` held by `AppState` is always this form.
    pub(crate) fn new_db(db: sea_orm::DatabaseConnection, kind: DbKind) -> Self {
        let backend = db.get_database_backend();
        Conn {
            inner: ConnInner::Db(db),
            backend,
            kind,
        }
    }

    pub fn backend(&self) -> DbBackend {
        self.backend
    }

    pub fn kind(&self) -> DbKind {
        self.kind
    }

    /// Cheap: clones the underlying `Arc<Pool>` (sqlite/postgres) — same shape
    /// as the old `libsql::Conn` clone, so `db::conn` and `db::txn_conn`
    /// hand out owned handles without holding the state mutex across an await.
    pub fn clone_handle(&self) -> Conn {
        match &self.inner {
            ConnInner::Db(db) => Conn::new_db(db.clone(), self.kind),
            // A transaction handle is not clonable; callers never clone a Txn.
            ConnInner::Txn(_) => Conn::new_db(self.expect_db().clone(), self.kind),
        }
    }

    fn expect_db(&self) -> &sea_orm::DatabaseConnection {
        match &self.inner {
            ConnInner::Db(db) => db,
            ConnInner::Txn(_) => panic!("Conn::expect_db on a transaction handle"),
        }
    }

    /// Translate SQLite-style SQL to the active backend's native form, then
    /// build a `Statement` with the bound values. For SQLite the SQL is used
    /// verbatim; for Postgres the [`translate::translate_for_pg`] rewrites are applied.
    fn build_stmt(&self, sql: &str, params: ParamVec) -> Statement {
        let sql = if self.backend == DbBackend::Postgres {
            translate::translate_for_pg(sql)
        } else {
            sql.to_string()
        };
        Statement::from_sql_and_values(self.backend, sql, params)
    }

    /// `conn.execute(sql, params)` — the libsql-shaped mutation call. Returns
    /// the number of rows affected, like the old `libsql::Conn::execute`.
    pub async fn execute<P: IntoParams>(&self, sql: &str, params: P) -> Result<u64, DbErr> {
        let stmt = self.build_stmt(sql, params.into_params());
        let r = self.execute_raw(stmt).await?;
        Ok(r.rows_affected())
    }

    /// `conn.execute_unprepared(sql)`-shaped: run a possibly multi-statement
    /// script (schema DDL, `init_db`'s batches) with no bound parameters.
    /// `execute_unprepared` runs every `;`-separated statement on both backends.
    pub async fn execute_batch(&self, sql: &str) -> Result<(), DbErr> {
        match &self.inner {
            ConnInner::Db(db) => db.execute_unprepared(sql).await.map(|_| ()),
            // Transactions don't run schema batches; route to the inner if ever asked.
            ConnInner::Txn(tx) => tx.execute_unprepared(sql).await.map(|_| ()),
        }
    }

    /// `conn.query(sql, params)` returning every row at once. The libsql
    /// cursor (`rows.next().await`) is gone — sea-orm returns a `Vec` — so the
    /// handful of call sites that iterated a cursor are migrated to this.
    pub async fn query_all<P: IntoParams>(&self, sql: &str, params: P) -> Result<Vec<Row>, DbErr> {
        let stmt = self.build_stmt(sql, params.into_params());
        let rows = self.query_all_raw(stmt).await?;
        Ok(rows.into_iter().map(Row).collect())
    }

    /// First row only, or `None`. Used directly by a few call sites and by the
    /// `fetch_optional` helper.
    pub async fn query_one<P: IntoParams>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<Option<Row>, DbErr> {
        let stmt = self.build_stmt(sql, params.into_params());
        let row = self.query_one_raw(stmt).await?;
        Ok(row.map(Row))
    }

    /// `conn.transaction()` — begins a transaction and returns a `Conn` backed
    /// by the transaction handle, so `tx.execute(..)` / `tx.commit()` keep the
    /// libsql shape. Only valid on a pool-backed `Conn`.
    pub async fn transaction(&self) -> Result<Conn, DbErr> {
        let db = self.expect_db();
        let txn = db.begin().await?;
        Ok(Conn {
            inner: ConnInner::Txn(txn),
            backend: self.backend,
            kind: self.kind,
        })
    }

    /// `tx.commit()` — commits the transaction. Only valid on a Txn-backed Conn;
    /// consumes it, since SeaORM's `DatabaseTransaction::commit` takes `self`.
    pub async fn commit(self) -> Result<(), DbErr> {
        match self.inner {
            ConnInner::Txn(tx) => tx.commit().await,
            ConnInner::Db(_) => Err(DbErr::Custom("commit on a non-transaction Conn".into())),
        }
    }

    /// `tx.rollback()` — symmetric to `commit()`; consumes the transaction.
    pub async fn rollback(self) -> Result<(), DbErr> {
        match self.inner {
            ConnInner::Txn(tx) => tx.rollback().await,
            ConnInner::Db(_) => Err(DbErr::Custom("rollback on a non-transaction Conn".into())),
        }
    }

    /// Insert a row and return its new `id`. Replaces libsql's
    /// `last_insert_rowid()`, which has no Postgres equivalent. The caller
    /// writes `INSERT … RETURNING id` (valid on SQLite ≥3.35 and Postgres) and
    /// this fetches the returned id; works identically on either backend.
    pub async fn insert_returning_id<P: IntoParams>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<i64, DbErr> {
        let stmt = self.build_stmt(sql, params.into_params());
        let row = self
            .query_one_raw(stmt)
            .await?
            .ok_or_else(|| DbErr::Custom("INSERT ... RETURNING id returned no row".to_string()))?;
        row.try_get_by_index::<i64>(0)
    }

    // ── raw sea-orm forwarding (used by the helpers above and by fetch_*) ────

    async fn execute_raw(&self, stmt: Statement) -> Result<ExecResult, DbErr> {
        match &self.inner {
            ConnInner::Db(db) => db.execute_raw(stmt).await,
            ConnInner::Txn(tx) => tx.execute_raw(stmt).await,
        }
    }

    async fn query_all_raw(&self, stmt: Statement) -> Result<Vec<QueryResult>, DbErr> {
        match &self.inner {
            ConnInner::Db(db) => db.query_all_raw(stmt).await,
            ConnInner::Txn(tx) => tx.query_all_raw(stmt).await,
        }
    }

    async fn query_one_raw(&self, stmt: Statement) -> Result<Option<QueryResult>, DbErr> {
        match &self.inner {
            ConnInner::Db(db) => db.query_one_raw(stmt).await,
            ConnInner::Txn(tx) => tx.query_one_raw(stmt).await,
        }
    }
}

// ── fetch_* / scalar_i64 ────────────────────────────────────────────────────

/// First row only, mapped. `None` when the query matched nothing — the
/// `query_row(..).optional()` pattern. Same shape as the libsql helper, just
/// with `&Row` and `DbErr` in the closure.
pub async fn fetch_optional<T, F>(
    db: &Conn,
    sql: &str,
    params: impl IntoParams,
    map: F,
) -> Result<Option<T>, String>
where
    F: FnOnce(&Row) -> Result<T, DbErr>,
{
    let stmt = db.build_stmt(sql, params.into_params());
    let rows = db.query_all_raw(stmt).await.map_err(|e| e.to_string())?;
    match rows.into_iter().next() {
        Some(row) => map(&Row(row)).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// First row only, mapped, erroring when there is none — plain `query_row`.
pub async fn fetch_one<T, F>(
    db: &Conn,
    sql: &str,
    params: impl IntoParams,
    map: F,
) -> Result<T, String>
where
    F: FnOnce(&Row) -> Result<T, DbErr>,
{
    fetch_optional(db, sql, params, map)
        .await?
        .ok_or_else(|| "no rows returned".to_string())
}

/// Every row, mapped — `query_map(..).collect()`.
pub async fn fetch_all<T, F>(
    db: &Conn,
    sql: &str,
    params: impl IntoParams,
    mut map: F,
) -> Result<Vec<T>, String>
where
    F: FnMut(&Row) -> Result<T, DbErr>,
{
    let stmt = db.build_stmt(sql, params.into_params());
    let rows = db.query_all_raw(stmt).await.map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(map(&Row(row)).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// `SELECT COUNT(*)`-shaped queries, common enough to be worth their own
/// helper. Missing rows count as 0, matching the old `.unwrap_or(0)` use.
pub async fn scalar_i64(
    db: &Conn,
    sql: &str,
    params: impl IntoParams,
) -> Result<i64, String> {
    Ok(fetch_optional(db, sql, params, |row| row.get::<i64>(0))
        .await?
        .unwrap_or(0))
}
