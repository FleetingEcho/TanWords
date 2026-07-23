//! RSS/Atom feed handling: fetching+parsing remote feeds, persisting
//! subscribed feeds and cached entries to the DB, and the Tauri commands
//! that expose all of it to the frontend.

mod commands;
mod parse;
mod types;

// Re-export the full public surface at `crate::rss::*` so callers (notably
// the `invoke_handler` registration in lib.rs) don't need to know about the
// internal file layout.
pub use commands::*;
pub use parse::*;
pub use types::*;
