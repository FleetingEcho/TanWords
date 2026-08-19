-- ═══════════════════════════════════════════════════════════════════════════
-- TanWords Postgres schema — the current (v33) schema, hand-ported from the
-- SQLite schema + the 33 SQLite-era migrations, as one clean DDL. Postgres
-- starts from this fresh; the SQLite migration history is NOT replayed here.
--
-- This file grows batch-by-batch as features are proven on Postgres. Tables
-- not yet listed here are SQLite-only until their owning batch ports them.
--
-- Conventions vs the SQLite schema:
--   * `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGINT GENERATED ALWAYS AS
--     IDENTITY PRIMARY KEY` (so `INSERT … RETURNING id` works the same way).
--   * `INTEGER` → `BIGINT`; `REAL` → `DOUBLE PRECISION`; booleans stay
--     `BIGINT NOT NULL DEFAULT 0 CHECK (col IN (0,1))` to match the SQLite
--     0/1 storage the read-as-i64 code expects.
--   * Timestamps stay `TEXT`, written in SQLite's UTC `YYYY-MM-DD HH:MM:SS`
--     format (`to_char(now() AT TIME ZONE 'UTC', …)`), so the read-as-String
--     code path is identical on both backends.
--   * FTS5 virtual tables → `tsvector` columns + GIN indexes + triggers, added
--     when the search batch is ported (not yet present below).
-- ═══════════════════════════════════════════════════════════════════════════

-- User settings (also stores the schema fingerprint under __schema_fingerprint).
CREATE TABLE IF NOT EXISTS user_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── Vocabulary (spike batch: words/patterns) ────────────────────────────────

CREATE TABLE IF NOT EXISTS words (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    word            TEXT NOT NULL UNIQUE,
    word_type       TEXT,
    level           TEXT,
    word_freq       BIGINT      NOT NULL DEFAULT 1,
    mnemonic        TEXT,
    notes           TEXT,
    user_notes      TEXT        NOT NULL DEFAULT '',
    source          TEXT        NOT NULL DEFAULT 'manual',
    created_at      TEXT        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at      TEXT        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    tags            TEXT        NOT NULL DEFAULT '[]',
    status          TEXT        NOT NULL DEFAULT 'learning',
    enrichment_text TEXT,
    enrichment_json TEXT,
    starred         BIGINT      NOT NULL DEFAULT 0 CHECK (starred IN (0, 1))
);

CREATE TABLE IF NOT EXISTS word_definitions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    word_id     BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    pos         TEXT   NOT NULL,
    zh          TEXT   NOT NULL,
    en          TEXT,
    example_en  TEXT,
    example_zh  TEXT,
    sort_order  BIGINT NOT NULL DEFAULT 0,
    created_at  TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_word_definitions_word_id ON word_definitions(word_id);

CREATE TABLE IF NOT EXISTS word_chats (
    word_id    BIGINT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
    messages   TEXT   NOT NULL DEFAULT '[]',
    updated_at TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── Spaced repetition + daily streaks (words/patterns deps) ────────────────

CREATE TABLE IF NOT EXISTS srs_records (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_id       BIGINT NOT NULL,
    entity_type     TEXT   NOT NULL,
    srs_level       BIGINT NOT NULL DEFAULT 0,
    srs_ease        DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    review_count    BIGINT NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    next_review_at  TEXT,
    UNIQUE(entity_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_srs_records_next_review ON srs_records(next_review_at);

CREATE TABLE IF NOT EXISTS daily_streaks (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "date"          TEXT   NOT NULL UNIQUE,
    words_added     BIGINT NOT NULL DEFAULT 0,
    sentences_added BIGINT NOT NULL DEFAULT 0,
    quiz_done       BIGINT NOT NULL DEFAULT 0,
    translations    BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_date ON daily_streaks(date);

-- ── Sentence-pattern library (spike batch) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS patterns (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pattern      TEXT NOT NULL,
    zh           TEXT NOT NULL DEFAULT '',
    function_tag TEXT NOT NULL DEFAULT 'other',
    level        TEXT,
    note         TEXT NOT NULL DEFAULT '',
    analysis     TEXT,
    created_at   TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    starred      BIGINT NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
    updated_at   TEXT   NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pattern_examples (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pattern_id BIGINT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    sentence   TEXT   NOT NULL,
    source     TEXT   NOT NULL DEFAULT '',
    article_id BIGINT,
    created_at TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_pattern_examples_pattern ON pattern_examples(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_examples_article ON pattern_examples(article_id);

CREATE TABLE IF NOT EXISTS pattern_practice (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pattern_id BIGINT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    sentence   TEXT   NOT NULL,
    feedback   TEXT   NOT NULL DEFAULT '',
    verdict    TEXT   NOT NULL DEFAULT '',
    saved      BIGINT NOT NULL DEFAULT 0,
    created_at TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_pattern_practice_pattern ON pattern_practice(pattern_id);

-- ── Calendar (init_db_postgres seeds default calendars, so the tables must
-- exist on a fresh Postgres database even before the calendar batch is
-- exercised end-to-end). ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_calendars (
    id         TEXT PRIMARY KEY,
    name       TEXT   NOT NULL,
    color_name TEXT   NOT NULL DEFAULT 'blue',
    visible    BIGINT NOT NULL DEFAULT 1,
    sort_order BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id          TEXT PRIMARY KEY,
    calendar_id TEXT   NOT NULL DEFAULT 'default',
    title       TEXT   NOT NULL DEFAULT '',
    "start"     TEXT   NOT NULL,
    "end"       TEXT   NOT NULL,
    all_day     BIGINT NOT NULL DEFAULT 0,
    description TEXT   NOT NULL DEFAULT '',
    location    TEXT   NOT NULL DEFAULT '',
    created_at  TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at  TEXT   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    color_name  TEXT,
    CONSTRAINT calendar_events_calendar_id_fk FOREIGN KEY (calendar_id)
        REFERENCES calendar_calendars(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id);
