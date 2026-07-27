use super::Migration;

pub(super) const MIGRATION_22: Migration = Migration {
    version: 22,
    description: "add starred flag to words for quick pinning in the vocabulary list",
    sql: "
            ALTER TABLE words ADD COLUMN starred INTEGER NOT NULL DEFAULT 0
                CHECK(starred IN (0, 1));
        ",
};

pub(super) const MIGRATION_23: Migration = Migration {
    version: 23,
    description: "reading library: saved paste-in articles with AI comments, full-text searchable",
    sql: "
            CREATE TABLE IF NOT EXISTS reading_articles (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT NOT NULL DEFAULT '',
                content      TEXT NOT NULL DEFAULT '',
                word_count   INTEGER NOT NULL DEFAULT 0,
                -- Where it came from: pasted by hand, added by an agent over
                -- MCP, or saved out of the RSS reader.
                source       TEXT NOT NULL DEFAULT 'paste',
                source_url   TEXT NOT NULL DEFAULT '',
                tags         TEXT NOT NULL DEFAULT '[]',
                created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_reading_articles_read ON reading_articles(last_read_at DESC);

            -- anchor_text is the sentence a comment is about; NULL means the
            -- comment is about the whole article. That single column is what
            -- lets an agent's notes render beside the text they refer to
            -- instead of piling up at the end.
            CREATE TABLE IF NOT EXISTS reading_article_comments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id  INTEGER NOT NULL REFERENCES reading_articles(id) ON DELETE CASCADE,
                author      TEXT NOT NULL DEFAULT 'ai',
                body        TEXT NOT NULL DEFAULT '',
                anchor_text TEXT,
                created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_reading_comments_article ON reading_article_comments(article_id);

            CREATE VIRTUAL TABLE IF NOT EXISTS reading_articles_fts USING fts5(
                title, content, content='reading_articles', content_rowid='id'
            );
            CREATE TRIGGER IF NOT EXISTS reading_articles_ai AFTER INSERT ON reading_articles BEGIN
                INSERT INTO reading_articles_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS reading_articles_ad AFTER DELETE ON reading_articles BEGIN
                INSERT INTO reading_articles_fts(reading_articles_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS reading_articles_au AFTER UPDATE ON reading_articles BEGIN
                INSERT INTO reading_articles_fts(reading_articles_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
                INSERT INTO reading_articles_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
        ",
};
