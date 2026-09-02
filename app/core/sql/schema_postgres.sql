-- Auto-generated from the SQLite schema (schema.sql + migrations) for the
-- Postgres backend. Translated by a one-off script that ran the SQLite
-- init_db pass, dumped sqlite_master, and rewrote the DDL:
--   INTEGER PRIMARY KEY AUTOINCREMENT -> BIGINT GENERATED ALWAYS AS IDENTITY
--   INTEGER -> BIGINT, REAL -> DOUBLE PRECISION, DATETIME/TIMESTAMP -> TEXT
--   BLOB -> BYTEA
--   CURRENT_TIMESTAMP/datetime('now') -> to_char(now() AT TIME ZONE 'UTC', ...)
--   reserved-word columns (date/start/end/natural/...) quoted as identifiers
-- Tables are topologically ordered by FK dependencies (Postgres requires the
-- referenced table to exist before the referencing one). Indexes follow.
-- Kept in sync with schema.sql via the fingerprint hash in db::mod.
-- FTS5 virtual tables are NOT here: full-text search is SQLite-only for now
-- (Postgres tsvector+GIN is the follow-up port).

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
            id            TEXT PRIMARY KEY,
            title         TEXT    NOT NULL DEFAULT 'New Chat',
            messages      TEXT    NOT NULL DEFAULT '[]',
            system_prompt TEXT    NOT NULL DEFAULT '',
            preset_id     TEXT    NOT NULL DEFAULT 'english-tutor',
            provider_id   TEXT    NOT NULL DEFAULT '',
            message_count BIGINT NOT NULL DEFAULT 0,
            created_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
            updated_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        , archived BIGINT NOT NULL DEFAULT 0, pinned BIGINT NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS ai_providers (
                device_id   TEXT NOT NULL,
                id          TEXT NOT NULL,
                name        TEXT NOT NULL DEFAULT '',
                
                
                
                kind        TEXT NOT NULL DEFAULT 'custom',
                api_base    TEXT NOT NULL DEFAULT '',
                model_id    TEXT NOT NULL DEFAULT '',
                
                
                api_key_enc TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                updated_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                PRIMARY KEY (device_id, id)
            );

CREATE TABLE IF NOT EXISTS articles (
            id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            title      TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL DEFAULT '',
            origin     TEXT NOT NULL DEFAULT 'pasted',
            content    TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        , analysis_markdown TEXT NOT NULL DEFAULT '', hn_item_id BIGINT);

CREATE TABLE IF NOT EXISTS calendar_calendars (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            color_name TEXT NOT NULL DEFAULT 'blue',
            visible    BIGINT NOT NULL DEFAULT 1,
            sort_order BIGINT NOT NULL DEFAULT 0
        );

CREATE TABLE IF NOT EXISTS calendar_events (
            id           TEXT PRIMARY KEY,
            calendar_id  TEXT NOT NULL DEFAULT 'default',
            title        TEXT NOT NULL DEFAULT '',
            "start"        TEXT NOT NULL,
            "end"          TEXT NOT NULL,
            all_day      BIGINT NOT NULL DEFAULT 0,
            description  TEXT NOT NULL DEFAULT '',
            location     TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
            updated_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')), color_name TEXT,
            -- ntfy reminders (see src/ntfy.rs): NULL = no reminder. Timed
            -- events store minutes-before-start; all-day events store 0 and
            -- remind at the configured morning time.
            reminder_minutes BIGINT,
            reminder_sent_at TEXT,
            FOREIGN KEY(calendar_id) REFERENCES calendar_calendars(id) ON DELETE SET NULL
        );

CREATE TABLE IF NOT EXISTS custom_providers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  api_base     TEXT NOT NULL,
  api_key      TEXT NOT NULL,     
  model_id     TEXT NOT NULL,
  is_active    BIGINT DEFAULT 1,
  sort_order   BIGINT DEFAULT 0,
  created_at   TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS daily_streaks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "date"            TEXT NOT NULL UNIQUE,
  words_added     BIGINT DEFAULT 0,
  sentences_added BIGINT DEFAULT 0,
  quiz_done       BIGINT DEFAULT 0,
  translations    BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS db_imports (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_path        TEXT NOT NULL,
  file_size        BIGINT,
  total_words      BIGINT DEFAULT 0,
  total_sentences  BIGINT DEFAULT 0,
  new_words        BIGINT DEFAULT 0,
  merged_words     BIGINT DEFAULT 0,
  conflict_words   BIGINT DEFAULT 0,
  new_sentences    BIGINT DEFAULT 0,
  status           TEXT DEFAULT 'pending',
  created_at       TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS documents (
            id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            title        TEXT    NOT NULL DEFAULT 'Untitled',
            content      TEXT    NOT NULL DEFAULT '{}',
            content_text TEXT    NOT NULL DEFAULT '',
            tags         TEXT    NOT NULL DEFAULT '[]',
            pinned       BIGINT NOT NULL DEFAULT 0,
            word_count   BIGINT NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
            updated_at   TEXT    NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
        , protected BIGINT NOT NULL DEFAULT 0, protection_salt BYTEA, wrapped_key BYTEA, folder TEXT NOT NULL DEFAULT '', task_total BIGINT NOT NULL DEFAULT 0, task_done  BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS document_assets (
            id          TEXT PRIMARY KEY,
            document_id BIGINT NOT NULL,
            file_name   TEXT NOT NULL DEFAULT 'image',
            mime_type   TEXT NOT NULL,
            data        BYTEA NOT NULL,
            size        BIGINT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS document_folders (
                path       TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
            , locked BIGINT NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS feed_bookmarks (
                id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                url            TEXT NOT NULL UNIQUE,
                title          TEXT NOT NULL DEFAULT '',
                feed_title     TEXT NOT NULL DEFAULT '',
                "domain"         TEXT NOT NULL DEFAULT '',
                summary        TEXT NOT NULL DEFAULT '',
                image_url      TEXT,
                audio_url      TEXT,
                audio_duration BIGINT,
                hn_item_id     BIGINT,
                published      TEXT NOT NULL DEFAULT '',
                created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS knowledge_maps (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                root_label TEXT NOT NULL,
                root_type TEXT NOT NULL DEFAULT 'topic',
                target_levels TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS words (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word          TEXT NOT NULL UNIQUE,
  word_type     TEXT,
  level         TEXT,
  word_freq     BIGINT DEFAULT 1,
  mnemonic      TEXT,
  notes         TEXT,
  user_notes    TEXT DEFAULT '',
  source        TEXT DEFAULT 'manual',
  created_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, enrichment_json TEXT, tags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'learning', enrichment_text TEXT, starred BIGINT NOT NULL DEFAULT 0
                CHECK (starred IN (0, 1)));

CREATE TABLE IF NOT EXISTS knowledge_nodes (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                map_id BIGINT NOT NULL REFERENCES knowledge_maps(id) ON DELETE CASCADE,
                parent_id BIGINT REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('topic','category','word','phrase','situation','contrast')),
                label TEXT NOT NULL,
                zh TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                depth BIGINT NOT NULL DEFAULT 0,
                sort_order BIGINT NOT NULL DEFAULT 0,
                expanded BIGINT NOT NULL DEFAULT 0 CHECK (expanded IN (0,1)),
                word_id BIGINT REFERENCES words(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                UNIQUE (map_id, parent_id, label)
            );

CREATE TABLE IF NOT EXISTS knowledge_edges (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                map_id BIGINT NOT NULL REFERENCES knowledge_maps(id) ON DELETE CASCADE,
                source_id BIGINT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
                target_id BIGINT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
                relation TEXT NOT NULL DEFAULT 'contains',
                UNIQUE (map_id, source_id, target_id, relation)
            );

CREATE TABLE IF NOT EXISTS sentences (
                id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sentence    TEXT NOT NULL,
                zh          TEXT NOT NULL DEFAULT '',
                level       TEXT,
                note        TEXT NOT NULL DEFAULT '',
                source      TEXT NOT NULL DEFAULT '',
                article_id  BIGINT REFERENCES articles(id) ON DELETE SET NULL,
                starred     BIGINT NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
                created_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                updated_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  total        BIGINT NOT NULL,
  correct      BIGINT NOT NULL,
  duration_sec BIGINT,
  quiz_type    TEXT,
  created_at   TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  entity_id   BIGINT NOT NULL,
  entity_type TEXT NOT NULL,
  is_correct  BIGINT NOT NULL,
  user_answer TEXT,
  created_at  TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS reading_articles (
                id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                title        TEXT NOT NULL DEFAULT '',
                content      TEXT NOT NULL DEFAULT '',
                word_count   BIGINT NOT NULL DEFAULT 0,
                
                
                source       TEXT NOT NULL DEFAULT 'paste',
                source_url   TEXT NOT NULL DEFAULT '',
                tags         TEXT NOT NULL DEFAULT '[]',
                created_at   TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                updated_at   TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                last_read_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS reading_article_comments (
                id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                article_id  BIGINT NOT NULL REFERENCES reading_articles(id) ON DELETE CASCADE,
                author      TEXT NOT NULL DEFAULT 'ai',
                body        TEXT NOT NULL DEFAULT '',
                anchor_text TEXT,
                created_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS rss_feeds (
                id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                title           TEXT NOT NULL DEFAULT '',
                url             TEXT NOT NULL,
                site_link       TEXT NOT NULL DEFAULT '',
                description     TEXT NOT NULL DEFAULT '',
                last_fetched_at TEXT,
                created_at      TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            , category_override TEXT
                CHECK (category_override IN ('article', 'podcast')), is_pinned BIGINT NOT NULL DEFAULT 0
                CHECK (is_pinned IN (0, 1)), pin_order BIGINT, is_paused BIGINT NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS rss_entries (
                id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                feed_id     BIGINT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                url         TEXT NOT NULL UNIQUE,
                author      TEXT NOT NULL DEFAULT '',
                summary     TEXT NOT NULL DEFAULT '',
                image_url   TEXT,
                published   TEXT NOT NULL DEFAULT '',
                is_read     BIGINT NOT NULL DEFAULT 0,
                fetched_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
            , audio_url TEXT, audio_duration BIGINT, hn_item_id BIGINT);

CREATE TABLE IF NOT EXISTS scenes (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                scene_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                scene_type TEXT NOT NULL DEFAULT 'prebuilt',
                asset_path TEXT NOT NULL DEFAULT '',
                generation_version BIGINT NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS scene_objects (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                scene_id BIGINT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                object_key TEXT NOT NULL,
                label TEXT NOT NULL,
                position_json TEXT NOT NULL DEFAULT '[0,0,0]',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE (scene_id, object_key)
            );

CREATE TABLE IF NOT EXISTS scene_lessons (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                scene_id BIGINT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                target_levels TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('generating','ready','failed','archived')),
                prompt_version BIGINT NOT NULL DEFAULT 1,
                generation_key TEXT NOT NULL UNIQUE,
                generated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS scene_vocabulary (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                lesson_id BIGINT NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                object_id BIGINT NOT NULL REFERENCES scene_objects(id) ON DELETE CASCADE,
                word_id BIGINT REFERENCES words(id) ON DELETE SET NULL,
                word TEXT NOT NULL,
                zh TEXT NOT NULL DEFAULT '',
                ipa TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                importance BIGINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
                learning_status TEXT NOT NULL DEFAULT 'new' CHECK (learning_status IN ('new','learning','familiar','mastered')),
                UNIQUE (lesson_id, word)
            );

CREATE TABLE IF NOT EXISTS scene_sessions (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                lesson_id BIGINT NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                mode TEXT NOT NULL CHECK (mode IN ('explore','semantic','task','test')),
                started_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                completed_at TEXT
            );

CREATE TABLE IF NOT EXISTS scene_attempts (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                session_id BIGINT NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
                scene_vocabulary_id BIGINT NOT NULL REFERENCES scene_vocabulary(id) ON DELETE CASCADE,
                mode TEXT NOT NULL CHECK (mode IN ('explore','semantic','task','test')),
                correct BIGINT NOT NULL CHECK (correct IN (0,1)),
                response_ms BIGINT NOT NULL DEFAULT 0,
                hints_used BIGINT NOT NULL DEFAULT 0,
                attempted_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS scene_examples (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                scene_vocabulary_id BIGINT NOT NULL REFERENCES scene_vocabulary(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('collocation','action','sentence')),
                content_en TEXT NOT NULL,
                content_zh TEXT NOT NULL DEFAULT ''
            );

CREATE TABLE IF NOT EXISTS scene_relations (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                lesson_id BIGINT NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                source_key TEXT NOT NULL,
                relation TEXT NOT NULL CHECK (relation IN ('located_near','used_for','followed_by','belongs_to')),
                target_key TEXT NOT NULL
            );

CREATE TABLE IF NOT EXISTS scene_tasks (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                lesson_id BIGINT NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                title_en TEXT NOT NULL,
                title_zh TEXT NOT NULL DEFAULT '',
                steps_json TEXT NOT NULL,
                sort_order BIGINT NOT NULL DEFAULT 0
            );

CREATE TABLE IF NOT EXISTS search_history (
                id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                word        TEXT NOT NULL,
                searched_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS srs_records (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id       BIGINT NOT NULL,
  entity_type     TEXT NOT NULL,
  srs_level       BIGINT DEFAULT 0,
  srs_ease        DOUBLE PRECISION DEFAULT 2.5,
  review_count    BIGINT DEFAULT 0,
  last_reviewed_at TEXT,
  next_review_at  TEXT, stability DOUBLE PRECISION NOT NULL DEFAULT 0, difficulty DOUBLE PRECISION NOT NULL DEFAULT 0, elapsed_days BIGINT NOT NULL DEFAULT 0, scheduled_days BIGINT NOT NULL DEFAULT 0, lapses BIGINT NOT NULL DEFAULT 0, state BIGINT NOT NULL DEFAULT 0,
  UNIQUE (entity_id, entity_type)
);

CREATE TABLE IF NOT EXISTS standalone_assets (
            id          TEXT PRIMARY KEY,
            file_name   TEXT NOT NULL DEFAULT 'file',
            mime_type   TEXT NOT NULL,
            data        BYTEA NOT NULL,
            size        BIGINT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
        , remote_key TEXT);

-- Missing from the original auto-generated dump (added to init_db_sqlite
-- after schema_postgres.sql was last regenerated) — the Cloudflare R2 bucket
-- config, sealed with this device's key (see r2::mod's `seal`/`unseal`).
-- Without this table, saving R2 config against a Postgres connection errors
-- outright, and any full-overwrite import silently drops the row (it can't
-- insert into a table that doesn't exist).
CREATE TABLE IF NOT EXISTS r2_config (
  id         BIGINT PRIMARY KEY CHECK (id = 1),
  config_enc TEXT NOT NULL
);

-- The shared vault key for a Postgres profile (see the matching table in
-- schema.sql and `secrets::vault_key`). Sealed with a key derived from the
-- Postgres connection password, so every device/web session sharing this
-- database opens the same vault key — R2 config and AI provider keys then
-- roam across platforms without a per-device env var.
CREATE TABLE IF NOT EXISTS vault_key (
  id         BIGINT PRIMARY KEY CHECK (id = 1),
  key_enc    TEXT NOT NULL,
  salt       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS translations (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_text  TEXT NOT NULL,
  result_text  TEXT NOT NULL,
  source_lang  TEXT DEFAULT 'auto',
  target_lang  TEXT NOT NULL,
  provider     TEXT NOT NULL,
  mode         TEXT DEFAULT 'translate',
  context      TEXT,
  cluster_tag  TEXT,
  created_at   TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS user_known_words (
            word       TEXT PRIMARY KEY,
            source     TEXT NOT NULL DEFAULT 'marked',
            created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS user_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS word_chats (
            word_id BIGINT PRIMARY KEY,
            messages TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
            FOREIGN KEY(word_id) REFERENCES words(id)
        );

CREATE TABLE IF NOT EXISTS word_definitions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word_id       BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  pos           TEXT NOT NULL,
  zh            TEXT NOT NULL,
  en            TEXT,
  example_en    TEXT,
  example_zh    TEXT,
  sort_order    BIGINT DEFAULT 0,
  created_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS word_etymology (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word_id       BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  parts         TEXT,
  story         TEXT,
  origin_lang   TEXT,
  first_use_era TEXT
);

CREATE TABLE IF NOT EXISTS word_phonetics (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word_id       BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  locale        TEXT NOT NULL,
  ipa           TEXT NOT NULL,
  audio_url     TEXT,
  accent_label  TEXT
);

CREATE TABLE IF NOT EXISTS word_relations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_word_id  BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  to_word_id    BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  weight        DOUBLE PRECISION DEFAULT 1.0,
  note          TEXT,
  is_bidirect   BIGINT DEFAULT 0,
  source        TEXT DEFAULT 'ai',
  created_at    TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (from_word_id, to_word_id, relation_type)
);

CREATE TABLE IF NOT EXISTS writing_submissions (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                original_text TEXT NOT NULL,
                input_type TEXT NOT NULL CHECK (input_type IN ('sentence','essay')),
                detected_genre TEXT NOT NULL DEFAULT '',
                overall_feedback TEXT NOT NULL DEFAULT '',
                refined_full_text TEXT NOT NULL DEFAULT '',
                structure_feedback TEXT NOT NULL DEFAULT '',
                coherence_feedback TEXT NOT NULL DEFAULT '',
                tone_feedback TEXT NOT NULL DEFAULT '',
                sentence_count BIGINT NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS writing_model_essays (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                submission_id BIGINT NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
                "position" BIGINT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS writing_sentences (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                submission_id BIGINT NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
                "position" BIGINT NOT NULL,
                original TEXT NOT NULL,
                corrected TEXT NOT NULL DEFAULT '',
                "natural" TEXT NOT NULL DEFAULT '',
                explanation TEXT NOT NULL DEFAULT ''
            );

CREATE TABLE IF NOT EXISTS writing_summaries (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT NOT NULL CHECK (source_type IN ('sentences','submissions','summaries')),
                source_snapshot TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            );

CREATE TABLE IF NOT EXISTS writing_vocabulary (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sentence_id BIGINT NOT NULL REFERENCES writing_sentences(id) ON DELETE CASCADE,
                original_expression TEXT NOT NULL DEFAULT '',
                suggested_word TEXT NOT NULL,
                meaning TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                example_sentence TEXT NOT NULL DEFAULT '',
                selected BIGINT NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
                vocabulary_id BIGINT REFERENCES words(id) ON DELETE SET NULL
            );

-- Views (created by init_db_sqlite via execute_batch, not in schema.sql, so
-- added here manually: the auto-generation dump only captured tables/indexes).
-- all_document_assets: UNION of document_assets + standalone_assets so the
-- read paths stay a single query against both. Fully portable (UNION ALL).
-- Postgres has no `CREATE VIEW IF NOT EXISTS`; `CREATE OR REPLACE VIEW`
-- achieves the same idempotency (re-creates if it exists).
CREATE OR REPLACE VIEW all_document_assets AS
    SELECT id, document_id, file_name, mime_type, data, size, created_at, 0 AS standalone
      FROM document_assets
    UNION ALL
    SELECT id, 0 AS document_id, file_name, mime_type, data, size, created_at, 1 AS standalone
      FROM standalone_assets;

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_providers_device ON ai_providers(device_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar
            ON calendar_events(calendar_id);

CREATE INDEX IF NOT EXISTS idx_daily_streaks_date ON daily_streaks(date);

CREATE INDEX IF NOT EXISTS idx_document_assets_document
            ON document_assets(document_id);

CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder);

CREATE INDEX IF NOT EXISTS idx_feed_bookmarks_created
                ON feed_bookmarks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_edges_map ON knowledge_edges(map_id,source_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_map_parent ON knowledge_nodes(map_id,parent_id,sort_order);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_word ON knowledge_nodes(word_id);

CREATE INDEX IF NOT EXISTS idx_reading_articles_read ON reading_articles(last_read_at DESC);

CREATE INDEX IF NOT EXISTS idx_reading_comments_article ON reading_article_comments(article_id);

CREATE INDEX IF NOT EXISTS idx_rss_entries_feed ON rss_entries(feed_id, published DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feeds_url ON rss_feeds(url);

CREATE INDEX IF NOT EXISTS idx_sentences_created ON sentences(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scene_attempts_session ON scene_attempts(session_id, attempted_at);

CREATE INDEX IF NOT EXISTS idx_scene_attempts_vocab ON scene_attempts(scene_vocabulary_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_scene_lessons_scene ON scene_lessons(scene_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_scene_sessions_lesson ON scene_sessions(lesson_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scene_tasks_lesson ON scene_tasks(lesson_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_scene_vocab_lesson_object ON scene_vocabulary(lesson_id, object_id);

CREATE INDEX IF NOT EXISTS idx_scene_vocab_word ON scene_vocabulary(word_id);

CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history(searched_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_search_history_word ON search_history(word);

CREATE INDEX IF NOT EXISTS idx_srs_records_next_review ON srs_records(next_review_at);

CREATE INDEX IF NOT EXISTS idx_translations_created ON translations(created_at);

CREATE INDEX IF NOT EXISTS idx_word_definitions_word_id ON word_definitions(word_id);

CREATE INDEX IF NOT EXISTS idx_word_phonetics_word_id ON word_phonetics(word_id);

CREATE INDEX IF NOT EXISTS idx_word_relations_from ON word_relations(from_word_id);

CREATE INDEX IF NOT EXISTS idx_word_relations_to ON word_relations(to_word_id);

CREATE INDEX IF NOT EXISTS idx_words_source ON words(source);

CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);

CREATE INDEX IF NOT EXISTS idx_writing_sentences_submission ON writing_sentences(submission_id, position);

CREATE INDEX IF NOT EXISTS idx_writing_submissions_created ON writing_submissions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_writing_summaries_created ON writing_summaries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_writing_vocabulary_sentence ON writing_vocabulary(sentence_id);
