mod config;
mod controller;
mod markdown_blocks;
mod tools;
mod types;

#[cfg(test)]
mod tests;

// Glob re-exports (rather than named ones) so the hidden `__cmd__*` items that
// `#[crate::shim::command]` generates alongside each command function are re-exported
// too — the dispatch table looks them up at `crate::mcp::<name>`.
pub use config::*;
pub use controller::*;
pub use tools::{ChangeNotifier, TanWordsMcp};
