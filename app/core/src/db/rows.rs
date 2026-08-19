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
    /// verbatim; for Postgres the [`translate_for_pg`] rewrites are applied.
    fn build_stmt(&self, sql: &str, params: ParamVec) -> Statement {
        let sql = if self.backend == DbBackend::Postgres {
            translate_for_pg(sql)
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

// ── Postgres SQL translation ────────────────────────────────────────────────

/// Rewrite SQLite-style SQL into Postgres-native SQL. Applied only when the
/// active backend is Postgres; SQLite uses the original string verbatim.
///
/// - `?` and `?N` placeholders → `$1, $2, …` (in order of appearance). Postgres
///   parses a bare `?` as the jsonb-existence operator, so leaving them is a
///   hard syntax error, not a style choice.
/// - `INSERT OR IGNORE INTO …` → `INSERT INTO … ON CONFLICT DO NOTHING` (the
///   two are equivalent and both valid on SQLite ≥3.35 and Postgres, but
///   Postgres has no `OR IGNORE` clause).
/// - `date('now')` / `datetime('now')` / `CURRENT_DATE` / `CURRENT_TIMESTAMP`
///   → `to_char(now() AT TIME ZONE 'UTC', …)`. The codebase stores and reads
///   timestamps as TEXT in SQLite's `YYYY-MM-DD HH:MM:SS` (UTC) format
///   everywhere, so the Postgres TEXT columns get the same string written and
///   read back identically — no chrono read-path changes needed. The
///   multi-argument forms (`datetime('now', '+' || ? || ' days')`,
///   `date(?, '+1 day')`) are left untouched and ported per-feature when that
///   feature targets Postgres.
///
/// The scanner is quote/comment-aware so a literal `?` or `INSERT OR IGNORE`
/// inside a string constant or comment is left alone.
fn translate_for_pg(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 8);
    let mut chars = sql.chars().peekable();
    let mut idx = 0usize;
    let mut in_str = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    while let Some(c) = chars.next() {
        if in_line_comment {
            out.push(c);
            if c == '\n' {
                in_line_comment = false;
            }
            continue;
        }
        if in_block_comment {
            out.push(c);
            if c == '*' && matches!(chars.peek(), Some('/')) {
                chars.next();
                out.push('/');
                in_block_comment = false;
            }
            continue;
        }
        if in_str {
            out.push(c);
            if c == '\'' {
                if matches!(chars.peek(), Some('\'')) {
                    chars.next();
                    out.push('\''); // escaped '' stays inside the string
                } else {
                    in_str = false;
                }
            }
            continue;
        }
        match c {
            '-' => {
                out.push('-');
                if matches!(chars.peek(), Some('-')) {
                    chars.next();
                    out.push('-');
                    in_line_comment = true;
                }
            }
            '/' => {
                out.push('/');
                if matches!(chars.peek(), Some('*')) {
                    chars.next();
                    out.push('*');
                    in_block_comment = true;
                }
            }
            '\'' => {
                out.push('\'');
                in_str = true;
            }
            '?' => {
                // `?N` (numbered) reuses the same bind slot on both SQLite and
                // Postgres — map it to `$N` preserving N so a repeated `?1`
                // stays a single `$1` parameter (Postgres counts distinct `$N`
                // numbers, not occurrences). A bare `?` gets the next sequential
                // number, matching SQLite's positional binding.
                let mut digits = String::new();
                while matches!(chars.peek(), Some(d) if d.is_ascii_digit()) {
                    digits.push(*chars.peek().unwrap());
                    chars.next();
                }
                use std::fmt::Write;
                if digits.is_empty() {
                    idx += 1;
                    let _ = write!(out, "${idx}");
                } else {
                    let _ = write!(out, "${digits}");
                }
            }
            other => out.push(other),
        }
    }

    // `INSERT OR IGNORE INTO …` → `INSERT INTO … ON CONFLICT DO NOTHING`.
    // Only matched at the very start of the statement; an `OR IGNORE` buried
    // elsewhere would be unusual SQL and is left alone.
    if let Some(rest) = out.strip_prefix("INSERT OR IGNORE ") {
        let body = rest;
        if body.to_ascii_uppercase().contains("ON CONFLICT") {
            out = format!("INSERT {body}");
        } else {
            out = format!("INSERT {body} ON CONFLICT DO NOTHING");
        }
    }
    // `UPDATE OR REPLACE` is SQLite-only (it deletes conflicting rows on a
    // UNIQUE constraint before the update). Postgres has no such form. The
    // call sites that use it (folder rename/move) pre-create the target
    // chain and guard against moving a folder into its own subtree, so a real
    // UNIQUE collision on document_folders.path is not expected in practice;
    // dropping `OR REPLACE` keeps the statement parseable on Postgres.
    if let Some(rest) = out.strip_prefix("UPDATE OR REPLACE ") {
        out = format!("UPDATE {rest}");
    }
    // Timestamps as TEXT in SQLite's UTC `YYYY-MM-DD HH:MM:SS` format, so the
    // read-as-String code path is identical on both backends.
    out = out.replace("datetime('now')", "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
    out = out.replace("date('now')", "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
    out = out.replace("CURRENT_TIMESTAMP", "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
    out = out.replace("CURRENT_DATE", "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
    // Multi-arg date arithmetic. SQLite: `datetime('now', '+' || ?N || ' days')`
    // builds a string like `+5 days` at bind time; Postgres has no such form,
    // so emit `to_char((now() AT TIME ZONE 'UTC') + ($N || ' days')::interval, …)`.
    // The placeholder is already `$N` here (translated above), so the regex
    // matches `$1`, `$2`, etc. Both the `+`-prefixed and bare forms are covered.
    let multi_arg_dt = regex::Regex::new(
        r"datetime\('now',\s*'\+' \|\| \$(\d+) \|\| ' days'\)",
    )
    .unwrap();
    // The capture group holds the placeholder digits only (the leading `$`
    // is matched literally by `\$`). In regex replacement, `$$` emits a
    // literal `$`, so `$$$1` reconstructs the Postgres placeholder `$N`
    // (literal `$` + the captured digits).
    out = multi_arg_dt
        .replace_all(&out, "to_char((now() AT TIME ZONE 'UTC') + ($$$1 || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')")
        .into_owned();
    let multi_arg_date = regex::Regex::new(
        r"date\('now',\s*'\+' \|\| \$(\d+) \|\| ' days'\)",
    )
    .unwrap();
    out = multi_arg_date
        .replace_all(&out, "to_char((now() AT TIME ZONE 'UTC') + ($$$1 || ' days')::interval, 'YYYY-MM-DD')")
        .into_owned();
    // `date($N, '+1 day')` — SQLite's date() applied to a bound date string
    // with a +1-day modifier (used for inclusive end-of-range filters:
    // `updated_at < date(:to, '+1 day')`). Postgres has no date() function;
    // the equivalent is casting the bound text to a date, adding a day, and
    // formatting back to the TEXT 'YYYY-MM-DD' the columns store (so the
    // comparison stays text<text, which Postgres accepts without a cast).
    let date_plus_day = regex::Regex::new(r"date\(\$(\d+),\s*'\+1 day'\)").unwrap();
    out = date_plus_day
        .replace_all(&out, "to_char(($$$1)::date + 1, 'YYYY-MM-DD')")
        .into_owned();
    // `json_each(expr)` — SQLite's table-valued function that yields one row
    // per array element, with the element in a column named `value`. Postgres
    // equivalent: `jsonb_array_elements_text((expr)::jsonb)`, which also
    // names its output column `value`. The call sites only ever pass a simple
    // column reference (e.g. `d.tags`), so a no-nested-paren regex suffices.
    let json_each = regex::Regex::new(r"json_each\(([^()]+)\)").unwrap();
    out = json_each
        .replace_all(&out, "jsonb_array_elements_text(($1)::jsonb)")
        .into_owned();
    // `instr(haystack, needle)` — SQLite returns the 1-based position of
    // `needle` in `haystack` (0 if absent). Postgres has `strpos(haystack,
    // needle)` with identical argument order and the same 0-on-absent
    // semantics (NULL only on NULL input, which the call sites never pass).
    // `\b` keeps this from matching a longer identifier ending in "instr".
    let instr = regex::Regex::new(r"\binstr\(").unwrap();
    out = instr.replace_all(&out, "strpos(").into_owned();
    out
}

#[cfg(test)]
mod tests {
    use super::translate_for_pg;

    #[test]
    fn numbered_placeholders_preserve_their_number_bare_ones_sequence() {
        // `?N` preserves N (so a repeated `?1` stays a single `$1` parameter —
        // Postgres counts distinct `$N` numbers, not occurrences); a bare `?`
        // gets the next sequential number, matching SQLite's positional binding.
        assert_eq!(translate_for_pg("SELECT ?1 + ?2"), "SELECT $1 + $2");
        assert_eq!(translate_for_pg("SELECT ? + ?"), "SELECT $1 + $2");
        assert_eq!(translate_for_pg("WHERE id = ?10 AND x > ?2"), "WHERE id = $10 AND x > $2");
        assert_eq!(translate_for_pg("VALUES (?1, ?2, ?3)"), "VALUES ($1, $2, $3)");
        // reuse: both `?1` map to the same `$1` (one bind value, not two)
        assert_eq!(
            translate_for_pg("WHERE id != ?1 AND instr(content, 'x' || ?1) > 0"),
            "WHERE id != $1 AND strpos(content, 'x' || $1) > 0"
        );
        // bare `?` mixed with `?N`: bare ones sequence, numbered ones keep N
        assert_eq!(translate_for_pg("WHERE a = ? AND b = ?1 AND c = ?"), "WHERE a = $1 AND b = $1 AND c = $2");
    }

    #[test]
    fn question_marks_inside_string_literals_are_left_alone() {
        assert_eq!(
            translate_for_pg("SELECT 'is it? yes' FROM t WHERE c = ?1"),
            "SELECT 'is it? yes' FROM t WHERE c = $1"
        );
        // escaped '' inside a string keeps the literal ? through
        assert_eq!(
            translate_for_pg("SELECT 'it''s a ?' WHERE x = ?1"),
            "SELECT 'it''s a ?' WHERE x = $1"
        );
    }

    #[test]
    fn question_marks_in_comments_are_left_alone() {
        assert_eq!(
            translate_for_pg("SELECT ?1 -- a ? here\nFROM t WHERE x = ?2"),
            "SELECT $1 -- a ? here\nFROM t WHERE x = $2"
        );
        assert_eq!(
            translate_for_pg("SELECT /* a ? b */ ?1 FROM t"),
            "SELECT /* a ? b */ $1 FROM t"
        );
    }

    #[test]
    fn insert_or_ignore_becomes_on_conflict_do_nothing() {
        assert_eq!(
            translate_for_pg("INSERT OR IGNORE INTO t (a) VALUES (?1)"),
            "INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING"
        );
    }

    #[test]
    fn insert_or_ignore_with_an_existing_on_conflict_is_not_doubled() {
        assert_eq!(
            translate_for_pg("INSERT OR IGNORE INTO t (a) VALUES (?1) ON CONFLICT(a) DO UPDATE SET a = ?2"),
            "INSERT INTO t (a) VALUES ($1) ON CONFLICT(a) DO UPDATE SET a = $2"
        );
    }

    #[test]
    fn date_datetime_and_current_become_to_char_utc() {
        assert_eq!(
            translate_for_pg("WHERE d >= date('now')"),
            "WHERE d >= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
        );
        assert_eq!(
            translate_for_pg("SET updated_at = datetime('now') WHERE id = ?1"),
            "SET updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1"
        );
        assert_eq!(
            translate_for_pg("SET created_at = CURRENT_TIMESTAMP WHERE id = ?1"),
            "SET created_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1"
        );
        assert_eq!(
            translate_for_pg("WHERE d = CURRENT_DATE"),
            "WHERE d = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
        );
    }

    #[test]
    fn json_each_becomes_jsonb_array_elements_text() {
        // SQLite's `json_each(col)` → Postgres' table-valued function, which
        // also names its output column `value` so the WHERE clauses that
        // reference `value` keep working unchanged.
        assert_eq!(
            translate_for_pg("EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?1)"),
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text((d.tags)::jsonb) WHERE value = $1)"
        );
        assert_eq!(
            translate_for_pg("SELECT DISTINCT value FROM documents, json_each(documents.tags) ORDER BY value"),
            "SELECT DISTINCT value FROM documents, jsonb_array_elements_text((documents.tags)::jsonb) ORDER BY value"
        );
    }

    #[test]
    fn instr_becomes_strpos() {
        // SQLite `instr(haystack, needle)` and Postgres `strpos(haystack,
        // needle)` share argument order and the 0-on-absent result; the
        // translator just renames the function. `\b` avoids touching a
        // longer identifier that happens to end in "instr".
        assert_eq!(
            translate_for_pg("WHERE instr(content, 'tanwords-doc://' || ?1) > 0"),
            "WHERE strpos(content, 'tanwords-doc://' || $1) > 0"
        );
        assert_eq!(
            translate_for_pg("SELECT minstr(x, y) FROM t"),
            "SELECT minstr(x, y) FROM t" // word boundary respected
        );
    }

    #[test]
    fn update_or_replace_drops_or_replace() {
        // SQLite's `UPDATE OR REPLACE` (deletes conflicting UNIQUE rows before
        // the update) has no Postgres equivalent; the call sites pre-create
        // the target chain and guard against self-move, so dropping OR REPLACE
        // keeps the statement parseable without changing observable behavior.
        assert_eq!(
            translate_for_pg("UPDATE OR REPLACE documents SET folder = ?1 || substr(folder, length(?2) + 1) WHERE folder = ?2"),
            "UPDATE documents SET folder = $1 || substr(folder, length($2) + 1) WHERE folder = $2"
        );
    }

    #[test]
    fn date_placeholder_plus_one_day_becomes_date_cast_plus_one() {
        // SQLite `date(:to, '+1 day')` for an inclusive end-of-range filter;
        // Postgres has no date() function — cast the bound text to a date, add
        // a day, and format back to TEXT 'YYYY-MM-DD' so the comparison against
        // the TEXT column stays text<text (Postgres won't implicitly cast).
        assert_eq!(
            translate_for_pg("AND updated_at < date(?1, '+1 day')"),
            "AND updated_at < to_char(($1)::date + 1, 'YYYY-MM-DD')"
        );
    }

    #[test]
    fn multi_argument_datetime_now_becomes_interval_addition() {
        // SQLite `datetime('now', '+' || ?N || ' days')` builds the interval
        // string at bind time; Postgres has no such form, so the translator
        // emits an interval cast. The placeholder is already `$N` at the
        // point the regex runs.
        assert_eq!(
            translate_for_pg("WHERE next_review_at = datetime('now', '+' || ?1 || ' days')"),
            "WHERE next_review_at = to_char((now() AT TIME ZONE 'UTC') + ($1 || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')"
        );
        assert_eq!(
            translate_for_pg("WHERE d = date('now', '+' || ?3 || ' days')"),
            "WHERE d = to_char((now() AT TIME ZONE 'UTC') + ($3 || ' days')::interval, 'YYYY-MM-DD')"
        );
        // The bare single-arg forms are still handled by the plain replace.
        assert_eq!(
            translate_for_pg("SET updated_at = datetime('now') WHERE id = ?1"),
            "SET updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1"
        );
    }
}
