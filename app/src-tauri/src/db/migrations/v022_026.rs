use super::Migration;

pub(super) const MIGRATION_22: Migration = Migration {
    version: 22,
    description: "add starred flag to words for quick pinning in the vocabulary list",
    sql: "
            ALTER TABLE words ADD COLUMN starred INTEGER NOT NULL DEFAULT 0
                CHECK(starred IN (0, 1));
        ",
};
