use rusqlite::{Connection, Result as SqlResult};

/// A single forward-only schema change. Migrations run in order once each,
/// tracked in `schema_migrations`. Unlike the old `ALTER ... .ok()` pattern
/// (still used for a few legacy columns in `init_db`), a migration that
/// fails aborts startup instead of silently no-op'ing.
struct Migration {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "extend words with tags/status for batch tooling + SRS",
        sql: "
            ALTER TABLE words ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE words ADD COLUMN status TEXT NOT NULL DEFAULT 'learning';
            CREATE INDEX IF NOT EXISTS idx_words_source ON words(source);
            CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
        ",
    },
    Migration {
        version: 2,
        description: "drop the removed Grammar module's tables",
        sql: "
            DROP TABLE IF EXISTS grammar_rules;
            DROP TABLE IF EXISTS grammar_chats;
        ",
    },
    Migration {
        version: 3,
        description: "add FSRS fields to srs_records for spaced-repetition review",
        sql: "
            ALTER TABLE srs_records ADD COLUMN stability REAL NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN elapsed_days INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN scheduled_days INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE srs_records ADD COLUMN state INTEGER NOT NULL DEFAULT 0;
        ",
    },
    Migration {
        version: 4,
        description: "add search_history for the dictionary page's recent-lookups list",
        sql: "
            CREATE TABLE IF NOT EXISTS search_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                word        TEXT NOT NULL,
                searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history(searched_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_search_history_word ON search_history(word);
        ",
    },
    Migration {
        version: 5,
        description: "add patterns + pattern_examples for the sentence-pattern library",
        sql: "
            CREATE TABLE IF NOT EXISTS patterns (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern       TEXT NOT NULL,
                zh            TEXT NOT NULL DEFAULT '',
                function_tag  TEXT NOT NULL DEFAULT 'other',
                level         TEXT,
                note          TEXT NOT NULL DEFAULT '',
                analysis      TEXT,
                created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS pattern_examples (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_id  INTEGER NOT NULL,
                sentence    TEXT NOT NULL,
                source      TEXT NOT NULL DEFAULT '',
                article_id  INTEGER,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(pattern_id) REFERENCES patterns(id)
            );
            CREATE INDEX IF NOT EXISTS idx_pattern_examples_pattern ON pattern_examples(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_pattern_examples_article ON pattern_examples(article_id);
        ",
    },
    Migration {
        version: 6,
        description: "add rss_feeds for RSS feed subscriptions",
        sql: "
            CREATE TABLE IF NOT EXISTS rss_feeds (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                title           TEXT NOT NULL DEFAULT '',
                url             TEXT NOT NULL,
                site_link       TEXT NOT NULL DEFAULT '',
                description     TEXT NOT NULL DEFAULT '',
                last_fetched_at TEXT,
                created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feeds_url ON rss_feeds(url);
        ",
    },
    Migration {
        version: 7,
        description: "add pattern_practice for production practice (造句练习)",
        sql: "
            CREATE TABLE IF NOT EXISTS pattern_practice (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_id  INTEGER NOT NULL,
                sentence    TEXT NOT NULL,
                feedback    TEXT NOT NULL DEFAULT '',
                verdict     TEXT NOT NULL DEFAULT '',
                saved       INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(pattern_id) REFERENCES patterns(id)
            );
            CREATE INDEX IF NOT EXISTS idx_pattern_practice_pattern ON pattern_practice(pattern_id);
        ",
    },
    Migration {
        version: 8,
        description: "add words.enrichment_text for freeform AI word explanations",
        sql: "
            ALTER TABLE words ADD COLUMN enrichment_text TEXT;
        ",
    },
    Migration {
        version: 9,
        description: "drop the sentence-pattern library (patterns page removed)",
        sql: "
            DROP TABLE IF EXISTS pattern_practice;
            DROP TABLE IF EXISTS pattern_examples;
            DROP TABLE IF EXISTS patterns;
        ",
    },
    Migration {
        version: 10,
        description: "add rss_entries for cached RSS articles (read state, cover images)",
        sql: "
            CREATE TABLE IF NOT EXISTS rss_entries (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id     INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                url         TEXT NOT NULL UNIQUE,
                author      TEXT NOT NULL DEFAULT '',
                summary     TEXT NOT NULL DEFAULT '',
                image_url   TEXT,
                published   TEXT NOT NULL DEFAULT '',
                is_read     INTEGER NOT NULL DEFAULT 0,
                fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_rss_entries_feed ON rss_entries(feed_id, published DESC);
        ",
    },
    Migration {
        version: 11,
        description: "add audio enclosure fields to rss_entries for podcast playback",
        sql: "
            ALTER TABLE rss_entries ADD COLUMN audio_url TEXT;
            ALTER TABLE rss_entries ADD COLUMN audio_duration INTEGER;
        ",
    },
    Migration {
        version: 12,
        description: "add Scene Lab courses, spatial vocabulary, tasks and learning attempts",
        sql: "
            CREATE TABLE scenes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                scene_type TEXT NOT NULL DEFAULT 'prebuilt',
                asset_path TEXT NOT NULL DEFAULT '',
                generation_version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE scene_objects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                object_key TEXT NOT NULL,
                label TEXT NOT NULL,
                position_json TEXT NOT NULL DEFAULT '[0,0,0]',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE(scene_id, object_key)
            );
            CREATE TABLE scene_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                target_levels TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('generating','ready','failed','archived')),
                prompt_version INTEGER NOT NULL DEFAULT 1,
                generation_key TEXT NOT NULL UNIQUE,
                generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE scene_vocabulary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                object_id INTEGER NOT NULL REFERENCES scene_objects(id) ON DELETE CASCADE,
                word_id INTEGER REFERENCES words(id) ON DELETE SET NULL,
                word TEXT NOT NULL,
                zh TEXT NOT NULL DEFAULT '',
                ipa TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                importance INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
                learning_status TEXT NOT NULL DEFAULT 'new' CHECK(learning_status IN ('new','learning','familiar','mastered')),
                UNIQUE(lesson_id, word)
            );
            CREATE TABLE scene_examples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_vocabulary_id INTEGER NOT NULL REFERENCES scene_vocabulary(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('collocation','action','sentence')),
                content_en TEXT NOT NULL,
                content_zh TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE scene_relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                source_key TEXT NOT NULL,
                relation TEXT NOT NULL CHECK(relation IN ('located_near','used_for','followed_by','belongs_to')),
                target_key TEXT NOT NULL
            );
            CREATE TABLE scene_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                title_en TEXT NOT NULL,
                title_zh TEXT NOT NULL DEFAULT '',
                steps_json TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE scene_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
                mode TEXT NOT NULL CHECK(mode IN ('explore','semantic','task','test')),
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT
            );
            CREATE TABLE scene_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
                scene_vocabulary_id INTEGER NOT NULL REFERENCES scene_vocabulary(id) ON DELETE CASCADE,
                mode TEXT NOT NULL CHECK(mode IN ('explore','semantic','task','test')),
                correct INTEGER NOT NULL CHECK(correct IN (0,1)),
                response_ms INTEGER NOT NULL DEFAULT 0,
                hints_used INTEGER NOT NULL DEFAULT 0,
                attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX idx_scene_lessons_scene ON scene_lessons(scene_id, generated_at DESC);
            CREATE INDEX idx_scene_vocab_lesson_object ON scene_vocabulary(lesson_id, object_id);
            CREATE INDEX idx_scene_vocab_word ON scene_vocabulary(word_id);
            CREATE INDEX idx_scene_tasks_lesson ON scene_tasks(lesson_id, sort_order);
            CREATE INDEX idx_scene_sessions_lesson ON scene_sessions(lesson_id, started_at DESC);
            CREATE INDEX idx_scene_attempts_session ON scene_attempts(session_id, attempted_at);
            CREATE INDEX idx_scene_attempts_vocab ON scene_attempts(scene_vocabulary_id, attempted_at DESC);
        ",
    },
    Migration {
        version: 13,
        description: "add generic infinite knowledge maps",
        sql: "
            CREATE TABLE knowledge_maps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                root_label TEXT NOT NULL,
                root_type TEXT NOT NULL DEFAULT 'topic',
                target_levels TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE knowledge_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL REFERENCES knowledge_maps(id) ON DELETE CASCADE,
                parent_id INTEGER REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('topic','category','word','phrase','situation','contrast')),
                label TEXT NOT NULL,
                zh TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                depth INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                expanded INTEGER NOT NULL DEFAULT 0 CHECK(expanded IN (0,1)),
                word_id INTEGER REFERENCES words(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(map_id, parent_id, label)
            );
            CREATE TABLE knowledge_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL REFERENCES knowledge_maps(id) ON DELETE CASCADE,
                source_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
                target_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
                relation TEXT NOT NULL DEFAULT 'contains',
                UNIQUE(map_id, source_id, target_id, relation)
            );
            CREATE INDEX idx_knowledge_nodes_map_parent ON knowledge_nodes(map_id,parent_id,sort_order);
            CREATE INDEX idx_knowledge_nodes_word ON knowledge_nodes(word_id);
            CREATE INDEX idx_knowledge_edges_map ON knowledge_edges(map_id,source_id);
        ",
    },
];

pub fn run(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
    )?;

    let current: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .unwrap_or(0);

    for m in MIGRATIONS {
        if m.version <= current {
            continue;
        }
        conn.execute_batch(m.sql)
            .unwrap_or_else(|e| panic!("migration {} ({}) failed: {e}", m.version, m.description));
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            [m.version],
        )?;
    }

    Ok(())
}
