mod config;
mod controller;
mod tools;
mod types;

#[cfg(test)]
mod tests;

// Glob re-exports (rather than named ones) so the hidden `__cmd__*` items that
// `#[tauri::command]` generates alongside each command function are re-exported
// too — `tauri::generate_handler!` looks them up at `crate::mcp::<name>`.
pub use config::*;
pub use controller::*;
pub use tools::TanWordsMcp;
