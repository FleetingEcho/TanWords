use super::Migration;

/// A document's lifecycle status — "None", active, on hold, completed, dropped.
///
/// Empty string is "None" (the plan's sketch explicitly says don't use NULL:
/// the list query would need a coalesce on every row). Values are a closed set
/// (`active | onhold | completed | dropped`) validated in Rust before the
/// write, so the list can be filtered without sanitising free text.
pub(super) const MIGRATION_31: Migration = Migration {
    version: 31,
    description: "document lifecycle status column",
    sql: "
            ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT '';
        ",
};