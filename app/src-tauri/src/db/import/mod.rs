//! Merging another TanWords database file into the active one.
//!
//! The motivating case is bootstrapping a fresh online database from the local
//! one, but this works between any two TanWords databases in either direction.
//!
//! Two phases so the user decides before anything is written: `db_import_analyze`
//! opens the source read-only and reports what is new and what already exists;
//! `db_import_apply` takes a per-row decision for every conflict and writes the
//! result in one transaction.
//!
//! ## What is and isn't merged
//!
//! Only entities with a natural key can be merged, because a conflict is
//! meaningless without one:
//!
//! | entity          | key                                   |
//! |-----------------|---------------------------------------|
//! | words           | `lower(word)`                         |
//! | patterns        | `pattern`                             |
//! | reading articles| title + first 200 chars of content    |
//! | documents       | `title`                               |
//! | known words     | `word`                                |
//!
//! Everything else is deliberately left behind: `user_settings` is
//! device-scoped (it holds the MCP token, among other things) and importing it
//! would have two installs fighting over each other; `translations` is a cache;
//! scene-lab and quiz history are tied to ids that don't survive a merge.
//!
//! Overwriting a word replaces its content — definitions, enrichment, notes,
//! level — but never its `srs_records` row. Review scheduling is earned on the
//! device that did the reviewing, and there is no sensible way to merge two
//! FSRS histories; the target's progress wins. Genuinely new words do bring
//! their scheduling along, which is what makes a first import useful.

mod analyze;
mod apply;
mod apply_documents_known;
mod apply_patterns_articles;
mod source;
mod types;

pub use analyze::*;
pub use apply::*;
pub use types::*;
