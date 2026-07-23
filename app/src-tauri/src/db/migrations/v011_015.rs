use super::Migration;

pub(super) const MIGRATION_11: Migration = Migration {
    version: 11,
    description: "add audio enclosure fields to rss_entries for podcast playback",
    sql: "
            ALTER TABLE rss_entries ADD COLUMN audio_url TEXT;
            ALTER TABLE rss_entries ADD COLUMN audio_duration INTEGER;
        ",
};

pub(super) const MIGRATION_12: Migration = Migration {
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
};

pub(super) const MIGRATION_13: Migration = Migration {
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
};

pub(super) const MIGRATION_14: Migration = Migration {
    version: 14,
    description: "wipe knowledge maps for the document-flow redesign",
    sql: "
            DELETE FROM knowledge_edges;
            DELETE FROM knowledge_nodes;
            DELETE FROM knowledge_maps;
        ",
};

// Some in-the-wild databases have migrations 5/7 recorded in
// schema_migrations without the tables actually existing (schema drifted,
// likely via a backup restore). Re-run the idempotent DDL to self-heal.
pub(super) const MIGRATION_15: Migration = Migration {
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
};
