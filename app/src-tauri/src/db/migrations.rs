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
    Migration {
        version: 14,
        description: "wipe knowledge maps for the document-flow redesign",
        sql: "
            DELETE FROM knowledge_edges;
            DELETE FROM knowledge_nodes;
            DELETE FROM knowledge_maps;
        ",
    },
    // Some in-the-wild databases have migrations 5/7 recorded in
    // schema_migrations without the tables actually existing (schema drifted,
    // likely via a backup restore). Re-run the idempotent DDL to self-heal.
    Migration {
        version: 15,
        description: "recreate pattern tables lost to schema drift",
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
            CREATE INDEX IF NOT EXISTS idx_pattern_examples_pattern ON pattern_examples(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_pattern_examples_article ON pattern_examples(article_id);
            CREATE INDEX IF NOT EXISTS idx_pattern_practice_pattern ON pattern_practice(pattern_id);
        ",
    },
    Migration {
        version: 16,
        description: "add category overrides and pinned navigation to RSS feeds",
        sql: "
            ALTER TABLE rss_feeds ADD COLUMN category_override TEXT
                CHECK(category_override IN ('article', 'podcast'));
            ALTER TABLE rss_feeds ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0
                CHECK(is_pinned IN (0, 1));
            ALTER TABLE rss_feeds ADD COLUMN pin_order INTEGER;
            UPDATE rss_feeds
               SET is_pinned = 1, pin_order = id
             WHERE id IN (SELECT id FROM rss_feeds ORDER BY created_at DESC, id DESC LIMIT 5);
        ",
    },
    Migration {
        version: 17,
        description: "add Writing Studio submissions, analyses, vocabulary, essays and summaries",
        sql: "
            CREATE TABLE writing_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text TEXT NOT NULL,
                input_type TEXT NOT NULL CHECK(input_type IN ('sentence','essay')),
                detected_genre TEXT NOT NULL DEFAULT '',
                overall_feedback TEXT NOT NULL DEFAULT '',
                refined_full_text TEXT NOT NULL DEFAULT '',
                structure_feedback TEXT NOT NULL DEFAULT '',
                coherence_feedback TEXT NOT NULL DEFAULT '',
                tone_feedback TEXT NOT NULL DEFAULT '',
                sentence_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE writing_sentences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                original TEXT NOT NULL,
                corrected TEXT NOT NULL DEFAULT '',
                natural TEXT NOT NULL DEFAULT '',
                explanation TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE writing_vocabulary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sentence_id INTEGER NOT NULL REFERENCES writing_sentences(id) ON DELETE CASCADE,
                original_expression TEXT NOT NULL DEFAULT '',
                suggested_word TEXT NOT NULL,
                meaning TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                example_sentence TEXT NOT NULL DEFAULT '',
                selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
                vocabulary_id INTEGER REFERENCES words(id) ON DELETE SET NULL
            );
            CREATE TABLE writing_model_essays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE writing_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT NOT NULL CHECK(source_type IN ('sentences','submissions','summaries')),
                source_snapshot TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX idx_writing_submissions_created ON writing_submissions(created_at DESC);
            CREATE INDEX idx_writing_sentences_submission ON writing_sentences(submission_id, position);
            CREATE INDEX idx_writing_vocabulary_sentence ON writing_vocabulary(sentence_id);
            CREATE INDEX idx_writing_summaries_created ON writing_summaries(created_at DESC);
        ",
    },
    Migration {
        version: 18,
        description: "add hn_item_id to rss_entries for fetching Hacker News comments",
        sql: "
            ALTER TABLE rss_entries ADD COLUMN hn_item_id INTEGER;
        ",
    },
    Migration {
        version: 19,
        description: "add source to extracted_items so comment-derived native-usage items stay distinct from the article's own vocabulary pass",
        sql: "
            ALTER TABLE extracted_items ADD COLUMN source TEXT NOT NULL DEFAULT 'article';
        ",
    },
    Migration {
        version: 20,
        description: "replace the extracted_items candidate/accept workflow with an AI markdown note per article plus a manually-curated saved_sentences collection",
        sql: "
            ALTER TABLE articles ADD COLUMN analysis_markdown TEXT NOT NULL DEFAULT '';
            DROP TABLE IF EXISTS extracted_items;
            CREATE TABLE IF NOT EXISTS saved_sentences (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                text          TEXT NOT NULL,
                zh            TEXT NOT NULL DEFAULT '',
                note          TEXT NOT NULL DEFAULT '',
                article_id    INTEGER REFERENCES articles(id) ON DELETE SET NULL,
                article_title TEXT NOT NULL DEFAULT '',
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_saved_sentences_created ON saved_sentences(created_at DESC);
        ",
    },
    Migration {
        version: 21,
        description: "add hn_item_id to articles so the Reading lesson can show the original HN discussion, not just the AI's analysis of it",
        sql: "
            ALTER TABLE articles ADD COLUMN hn_item_id INTEGER;
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
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_16_adds_feed_preferences_and_pins_five() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME);
             INSERT INTO schema_migrations(version) VALUES (15);
             CREATE TABLE rss_feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
                site_link TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
                last_fetched_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .unwrap();
        for i in 0..7 {
            conn.execute(
                "INSERT INTO rss_feeds(title, url) VALUES (?1, ?2)",
                rusqlite::params![format!("feed {i}"), format!("https://example.com/{i}")],
            )
            .unwrap();
        }

        run(&conn).unwrap();

        let pinned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rss_feeds WHERE is_pinned = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let category: Option<String> = conn
            .query_row("SELECT category_override FROM rss_feeds LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(pinned, 5);
        assert_eq!(category, None);
    }

    #[test]
    fn migration_20_replaces_extracted_items_with_markdown_notes_and_saved_sentences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME);
             INSERT INTO schema_migrations(version) VALUES (19);
             CREATE TABLE articles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                origin     TEXT NOT NULL DEFAULT 'pasted',
                content    TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE extracted_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                kind       TEXT NOT NULL DEFAULT 'word'
             );
             INSERT INTO articles (title, content) VALUES ('Test Article', 'Some content.');
             INSERT INTO extracted_items (article_id, kind) VALUES (1, 'word');",
        )
        .unwrap();

        run(&conn).unwrap();

        // extracted_items is fully superseded and dropped.
        let extracted_items_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='extracted_items'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(extracted_items_exists, 0);

        // articles gained analysis_markdown, defaulting to '' for existing rows.
        let markdown: String = conn
            .query_row("SELECT analysis_markdown FROM articles WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(markdown, "");
        conn.execute(
            "UPDATE articles SET analysis_markdown = ?1 WHERE id = 1",
            rusqlite::params!["## Words\n- **foo** — 中文"],
        )
        .unwrap();

        // saved_sentences supports the manual save flow, with article_id set null on delete.
        conn.execute(
            "INSERT INTO saved_sentences (text, zh, note, article_id, article_title) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["A great sentence.", "一句好句子", "note", 1, "Test Article"],
        )
        .unwrap();
        conn.execute("DELETE FROM articles WHERE id = 1", []).unwrap();
        let article_id: Option<i64> = conn
            .query_row("SELECT article_id FROM saved_sentences WHERE text = 'A great sentence.'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(article_id, None);
    }
}
