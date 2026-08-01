use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, SearcherBuilder};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::paths::ensure_md;
use super::types::{LocalDocItem, LocalDocSearchHit, LocalDocSearchResult};
use super::MAX_DEPTH;

fn walk(dir: &Path, root: &Path, depth: usize, out: &mut Vec<LocalDocItem>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        // DirEntry::file_type does NOT follow links: skip symlinks outright so
        // a vault containing a link to elsewhere can't leak outside files into
        // the listing (resolve() rejects reads/writes through them anyway).
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk(&path, root, depth + 1, out);
        } else if file_type.is_file() && ensure_md(&path).is_ok() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let rel_path = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| name.clone());
            out.push(LocalDocItem {
                rel_path,
                name,
                modified_ms,
                size: meta.len(),
            });
        }
    }
}

#[crate::shim::command]
pub fn localdocs_list(root: String) -> Result<Vec<LocalDocItem>, String> {
    let root_p = Path::new(&root);
    if !root_p.is_absolute() || !root_p.is_dir() {
        return Err(format!("Invalid mounted directory: {root}"));
    }
    let mut out = Vec::new();
    walk(root_p, root_p, 0, &mut out);
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Lightweight startup check for a persisted vault binding. Unlike
/// `localdocs_list`, this does not walk the directory tree.
#[crate::shim::command]
pub fn localdocs_root_exists(root: String) -> bool {
    let path = Path::new(&root);
    path.is_absolute() && path.is_dir()
}

fn fuzzy_path_match(path: &str, query: &str) -> bool {
    let mut chars = path.to_lowercase().chars().collect::<Vec<_>>().into_iter();
    query
        .to_lowercase()
        .chars()
        .all(|needle| chars.by_ref().any(|candidate| candidate == needle))
}

/// Full-text search built from ripgrep's own matcher/searcher crates. Results
/// are deliberately bounded so a broad query cannot flood the webview.
#[crate::shim::command]
pub fn localdocs_search(root: String, query: String) -> Result<Vec<LocalDocSearchResult>, String> {
    let root_p = Path::new(&root);
    if !root_p.is_absolute() || !root_p.is_dir() {
        return Err(format!("Invalid mounted directory: {root}"));
    }
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(true)
        .fixed_strings(true)
        .build(query)
        .map_err(|e| format!("Invalid search expression: {e}"))?;
    let mut results = Vec::new();

    for entry in ignore::WalkBuilder::new(root_p)
        .hidden(true)
        .git_ignore(true)
        .max_depth(Some(MAX_DEPTH + 1))
        .build()
        .filter_map(Result::ok)
    {
        if results.len() >= 100 {
            break;
        }
        let path = entry.path();
        if !entry.file_type().is_some_and(|kind| kind.is_file()) || ensure_md(path).is_err() {
            continue;
        }
        let rel_path = match path.strip_prefix(root_p) {
            Ok(rel) => rel.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        let mut hits = Vec::new();
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .max_matches(Some(3))
            .build();
        let _ = searcher.search_path(
            &matcher,
            path,
            UTF8(|line_number, line| {
                let line_text: String = line.trim().chars().take(240).collect();
                hits.push(LocalDocSearchHit {
                    line_number,
                    line_text,
                });
                Ok(true)
            }),
        );

        if !hits.is_empty() || fuzzy_path_match(&rel_path, query) {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| rel_path.clone());
            results.push(LocalDocSearchResult {
                rel_path,
                name,
                hits,
            });
        }
    }
    results.sort_by(|a, b| {
        fuzzy_path_match(&b.rel_path, query)
            .cmp(&fuzzy_path_match(&a.rel_path, query))
            .then_with(|| b.hits.len().cmp(&a.hits.len()))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    Ok(results)
}
