use super::Migration;

pub(super) const MIGRATION_16: Migration = Migration {
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
};

pub(super) const MIGRATION_17: Migration = Migration {
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
};

pub(super) const MIGRATION_18: Migration = Migration {
    version: 18,
    description: "add hn_item_id to rss_entries for fetching Hacker News comments",
    sql: "
            ALTER TABLE rss_entries ADD COLUMN hn_item_id INTEGER;
        ",
};

pub(super) const MIGRATION_19: Migration = Migration {
    version: 19,
    description: "add source to extracted_items so comment-derived native-usage items stay distinct from the article's own vocabulary pass",
    sql: "
            ALTER TABLE extracted_items ADD COLUMN source TEXT NOT NULL DEFAULT 'article';
        ",
};

pub(super) const MIGRATION_20: Migration = Migration {
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
};

pub(super) const MIGRATION_21: Migration = Migration {
    version: 21,
    description: "add hn_item_id to articles so the Reading lesson can show the original HN discussion, not just the AI's analysis of it",
    sql: "
            ALTER TABLE articles ADD COLUMN hn_item_id INTEGER;
        ",
};
