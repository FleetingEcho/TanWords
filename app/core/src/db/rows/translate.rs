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
pub(super) fn translate_for_pg(sql: &str) -> String {
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
