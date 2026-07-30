use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Wire types ──────────────────────────────────────────────────────────────

/// One row in the source that already exists in the target, with enough of
/// both sides shown for the user to pick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    /// Natural key, echoed back in the decisions to select this row.
    pub key: String,
    /// What the user recognises the row by.
    pub title: String,
    pub incoming: String,
    pub existing: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGroup {
    /// `words` | `patterns` | `articles` | `documents` | `knownWords`
    pub kind: String,
    /// Rows that don't exist in the target yet and will simply be added.
    pub new_count: i64,
    pub conflicts: Vec<ImportConflict>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    pub source_path: String,
    pub groups: Vec<ImportGroup>,
}

/// Which conflicting rows to overwrite, keyed by group kind. Anything absent is
/// skipped, so the safe default needs no client-side bookkeeping.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDecisions {
    #[serde(default)]
    pub overwrite: HashMap<String, Vec<String>>,
    /// Normally true — the whole point of an import. Exposed so "resolve these
    /// conflicts and nothing else" is possible.
    #[serde(default = "default_true")]
    pub include_new: bool,
}

fn default_true() -> bool {
    true
}

/// Written out rather than derived: `#[derive(Default)]` would ignore serde's
/// `default = "default_true"` and give `include_new: false`, so Rust callers
/// and JSON callers would disagree about what "default" means.
impl Default for ImportDecisions {
    fn default() -> Self {
        Self { overwrite: HashMap::new(), include_new: true }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub kind: String,
    pub added: i64,
    pub overwritten: i64,
    pub skipped: i64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub outcomes: Vec<ImportOutcome>,
    pub added: i64,
    pub overwritten: i64,
    pub skipped: i64,
}
