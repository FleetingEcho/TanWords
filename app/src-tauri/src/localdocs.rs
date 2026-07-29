//! Local markdown vault: file operations for a user-mounted folder on the
//! Documents page. Every command takes the mounted root plus a path relative
//! to it, and refuses anything that would escape the root — the frontend only
//! ever holds relative paths handed out by `localdocs_list`.

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, SearcherBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_DEPTH: usize = 12;

#[derive(Serialize)]
pub struct LocalDocItem {
    pub rel_path: String,
    pub name: String,
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct LocalDocSearchHit {
    pub line_number: u64,
    pub line_text: String,
}

#[derive(Serialize)]
pub struct LocalDocSearchResult {
    pub rel_path: String,
    pub name: String,
    pub hits: Vec<LocalDocSearchHit>,
}

#[derive(Serialize)]
pub struct MarkdownSource {
    pub path: String,
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct MarkdownExport {
    pub name: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAssetExport {
    pub name: String,
    pub data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownBundleExport {
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub assets: Vec<MarkdownAssetExport>,
}

fn unique_md_path(dir: &Path, file_name: &str) -> PathBuf {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Document");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("md");
    for index in 1..1000 {
        let name = if index == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} {index}.{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-copy.{ext}"))
}

fn unique_asset_path(dir: &Path, file_name: &str) -> PathBuf {
    let safe = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    let path = Path::new(safe);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("image");
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("bin");
    for index in 1..1000 {
        let name = if index == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{}-{}.{}", stem, uuid::Uuid::new_v4(), ext))
}

#[tauri::command]
pub fn localdocs_store_asset(
    root: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let root_path = Path::new(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err(format!("Invalid mounted directory: {root}"));
    }
    if mime_type.len() > 255 {
        return Err("Attachment MIME type is too long".into());
    }
    let data = STANDARD.decode(data_base64).map_err(|_| "Invalid attachment data")?;
    if data.is_empty() || data.len() > 100 * 1024 * 1024 {
        return Err("Attachment must be between 1 byte and 100 MB".into());
    }
    let assets_dir = root_path.join("assets");
    fs::create_dir_all(&assets_dir).map_err(|e| format!("Failed to create assets folder: {e}"))?;
    let destination = unique_asset_path(&assets_dir, &file_name);
    fs::write(&destination, data).map_err(|e| format!("Failed to save attachment: {e}"))?;
    let relative = destination.strip_prefix(root_path).map_err(|_| "Invalid attachment path")?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn markdown_read_files(paths: Vec<String>) -> Result<Vec<MarkdownSource>, String> {
    let mut out = Vec::new();
    for source in paths {
        let path = Path::new(&source);
        if !path.is_absolute() {
            return Err(format!("Invalid path: {source}"));
        }
        ensure_md(path)?;
        let content = fs::read_to_string(path).map_err(|e| format!("Failed to read: {e}"))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.md")
            .to_string();
        out.push(MarkdownSource {
            path: source,
            name,
            content,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn markdown_export_files(
    destination: String,
    files: Vec<MarkdownExport>,
) -> Result<usize, String> {
    let dir = Path::new(&destination);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("Invalid export directory: {destination}"));
    }
    for file in &files {
        let safe_name = Path::new(&file.name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.md");
        let safe_name = if safe_name.to_lowercase().ends_with(".md") {
            safe_name.to_string()
        } else {
            format!("{safe_name}.md")
        };
        fs::write(unique_md_path(dir, &safe_name), &file.content)
            .map_err(|e| format!("Failed to export: {e}"))?;
    }
    Ok(files.len())
}

#[tauri::command]
pub fn markdown_export_bundles(
    destination: String,
    files: Vec<MarkdownBundleExport>,
) -> Result<usize, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let dir = Path::new(&destination);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("Invalid export directory: {destination}"));
    }
    let assets_dir = dir.join("assets");
    if files.iter().any(|file| !file.assets.is_empty()) {
        fs::create_dir_all(&assets_dir).map_err(|e| format!("Failed to create assets folder: {e}"))?;
    }
    for file in &files {
        let safe_name = Path::new(&file.name)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Document.md");
        fs::write(unique_md_path(dir, safe_name), &file.content)
            .map_err(|e| format!("Failed to export document: {e}"))?;
        for asset in &file.assets {
            let safe_asset_name = Path::new(&asset.name)
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("Invalid asset name")?;
            let data = STANDARD.decode(&asset.data_base64).map_err(|_| "Invalid asset data")?;
            fs::write(assets_dir.join(safe_asset_name), data)
                .map_err(|e| format!("Failed to export image: {e}"))?;
        }
    }
    Ok(files.len())
}

#[tauri::command]
pub fn localdocs_import(root: String, sources: Vec<String>) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err(format!("Invalid mounted directory: {root}"));
    }
    let mut imported = Vec::with_capacity(sources.len());
    for source in &sources {
        let path = Path::new(source);
        ensure_md(path)?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.md");
        let destination = unique_md_path(root_path, name);
        fs::copy(path, &destination).map_err(|e| format!("Failed to import: {e}"))?;
        imported.push(
            destination
                .strip_prefix(root_path)
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|_| name.to_string()),
        );
    }
    Ok(imported)
}

#[tauri::command]
pub fn localdocs_export(
    root: String,
    rel_paths: Vec<String>,
    destination: String,
) -> Result<usize, String> {
    let destination = Path::new(&destination);
    if !destination.is_absolute() || !destination.is_dir() {
        return Err(format!("Invalid export directory: {}", destination.display()));
    }
    let assets_destination = destination.join("assets");
    let link_pattern = regex::Regex::new(r#"(?P<prefix>!?\[[^\]]*\]\()(?P<url>[^)\s]+)(?P<suffix>\))"#)
        .map_err(|e| e.to_string())?;
    for rel_path in &rel_paths {
        let source = resolve(&root, rel_path)?;
        ensure_md(&source)?;
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.md");
        let content = fs::read_to_string(&source).map_err(|e| format!("Failed to read: {e}"))?;
        let parent = source.parent().unwrap_or(Path::new(&root));
        let mut replacements = std::collections::HashMap::new();
        for capture in link_pattern.captures_iter(&content) {
            let Some(url) = capture.name("url").map(|value| value.as_str()) else { continue };
            if url.contains("://") || url.starts_with('#') {
                continue;
            }
            if replacements.contains_key(url) {
                continue;
            }
            let candidate = parent.join(url);
            let Ok(canonical) = candidate.canonicalize() else { continue };
            let root_assets = Path::new(&root).join("assets");
            let Ok(canonical_assets) = root_assets.canonicalize() else { continue };
            if !canonical.starts_with(&canonical_assets) || !canonical.is_file() {
                continue;
            }
            fs::create_dir_all(&assets_destination)
                .map_err(|e| format!("Failed to create assets folder: {e}"))?;
            let file_name = canonical.file_name().and_then(|value| value.to_str()).unwrap_or("attachment.bin");
            let exported = unique_asset_path(&assets_destination, file_name);
            fs::copy(&canonical, &exported).map_err(|e| format!("Failed to export attachment: {e}"))?;
            let exported_name = exported.file_name().and_then(|value| value.to_str()).unwrap_or(file_name);
            replacements.insert(url.to_string(), format!("./assets/{exported_name}"));
        }
        let rewritten = link_pattern.replace_all(&content, |capture: &regex::Captures<'_>| {
            let url = capture.name("url").map(|value| value.as_str()).unwrap_or("");
            match replacements.get(url) {
                Some(next) => format!("{}{}{}", &capture["prefix"], next, &capture["suffix"]),
                None => capture[0].to_string(),
            }
        });
        fs::write(unique_md_path(destination, name), rewritten.as_bytes())
            .map_err(|e| format!("Failed to export: {e}"))?;
    }
    Ok(rel_paths.len())
}

fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root_p = Path::new(root);
    if !root_p.is_absolute() || !root_p.is_dir() {
        return Err(format!("Invalid mounted directory: {root}"));
    }
    let rel_p = Path::new(rel);
    if rel_p.is_absolute()
        || rel_p
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(format!("Invalid path: {rel}"));
    }
    Ok(root_p.join(rel_p))
}

fn ensure_md(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") => {
            Ok(())
        }
        _ => Err("Only .md files can be used".into()),
    }
}

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
        if path.is_dir() {
            walk(&path, root, depth + 1, out);
        } else if ensure_md(&path).is_ok() {
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

#[tauri::command]
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
#[tauri::command]
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
#[tauri::command]
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

#[tauri::command]
pub fn localdocs_read(root: String, rel_path: String) -> Result<String, String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read: {e}"))
}

#[tauri::command]
pub fn localdocs_write(root: String, rel_path: String, content: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write: {e}"))
}

/// Create an empty markdown file in a vault directory, deduplicating the name
/// ("Untitled.md" → "Untitled 2.md"). Returns the new file's relative path.
#[tauri::command]
pub fn localdocs_create(
    root: String,
    name: String,
    directory: Option<String>,
) -> Result<String, String> {
    let stem = name.trim().trim_end_matches(".md").trim();
    if stem.is_empty() || stem.contains(['/', '\\']) {
        return Err(format!("Invalid file name: {name}"));
    }
    for i in 0..100 {
        let candidate = if i == 0 {
            format!("{stem}.md")
        } else {
            format!("{stem} {}.md", i + 1)
        };
        let rel_path = Path::new(directory.as_deref().unwrap_or(""))
            .join(&candidate)
            .to_string_lossy()
            .to_string();
        let path = resolve(&root, &rel_path)?;
        let parent = path.parent().ok_or("Invalid target folder")?;
        if !parent.is_dir() {
            return Err("Target folder does not exist".into());
        }
        if !path.exists() {
            fs::write(&path, "").map_err(|e| format!("Failed to create: {e}"))?;
            return Ok(rel_path);
        }
    }
    Err("Too many files with the same name".into())
}

/// Move one markdown file into an existing directory inside the mounted root.
/// Returns the file's new relative path and never overwrites an existing file.
#[tauri::command]
pub fn localdocs_move(
    root: String,
    rel_path: String,
    target_dir: String,
) -> Result<String, String> {
    let source = resolve(&root, &rel_path)?;
    ensure_md(&source)?;
    if !source.is_file() {
        return Err("Source file does not exist".into());
    }
    let directory = resolve(&root, &target_dir)?;
    if !directory.is_dir() {
        return Err("Target folder does not exist".into());
    }
    let file_name = source.file_name().ok_or("Invalid source file name")?;
    let destination = directory.join(file_name);
    let new_rel = destination
        .strip_prefix(Path::new(&root))
        .map_err(|_| "Invalid target path")?
        .to_string_lossy()
        .to_string();
    if destination == source {
        return Ok(new_rel);
    }
    if destination.exists() {
        return Err("A file with the same name already exists in the target folder".into());
    }
    fs::rename(&source, &destination).map_err(|e| format!("Failed to move: {e}"))?;
    Ok(new_rel)
}

/// Rename a file in place (same directory). Returns the new relative path.
#[tauri::command]
pub fn localdocs_rename(
    root: String,
    rel_path: String,
    new_name: String,
) -> Result<String, String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    let stem = new_name.trim().trim_end_matches(".md").trim();
    if stem.is_empty() || stem.contains(['/', '\\']) {
        return Err(format!("Invalid file name: {new_name}"));
    }
    let new_rel = Path::new(&rel_path)
        .parent()
        .unwrap_or(Path::new(""))
        .join(format!("{stem}.md"));
    let new_rel = new_rel.to_string_lossy().to_string();
    let new_path = resolve(&root, &new_rel)?;
    if new_path == path {
        return Ok(new_rel);
    }
    if new_path.exists() {
        return Err("A file with the same name already exists".into());
    }
    fs::rename(&path, &new_path).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(new_rel)
}

#[tauri::command]
pub fn localdocs_delete(root: String, rel_path: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{localdocs_create, localdocs_export, localdocs_move, localdocs_store_asset};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn creates_and_moves_files_without_overwriting() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tanwords-localdocs-{suffix}"));
        let target = root.join("notes");
        fs::create_dir_all(&target).unwrap();
        let root_string = root.to_string_lossy().to_string();

        let source = localdocs_create(root_string.clone(), "Draft".into(), None).unwrap();
        let moved = localdocs_move(root_string.clone(), source, "notes".into()).unwrap();
        assert_eq!(moved, "notes/Draft.md");
        assert!(target.join("Draft.md").is_file());

        let duplicate = localdocs_create(root_string.clone(), "Draft".into(), None).unwrap();
        assert!(localdocs_move(root_string, duplicate, "notes".into()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stores_pasted_images_in_a_deduplicated_assets_folder() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tanwords-localdocs-assets-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        let root_string = root.to_string_lossy().to_string();

        let first = localdocs_store_asset(
            root_string.clone(),
            "screenshot.png".into(),
            "image/png".into(),
            "YWJj".into(),
        ).unwrap();
        let second = localdocs_store_asset(
            root_string,
            "screenshot.png".into(),
            "image/png".into(),
            "ZGVm".into(),
        ).unwrap();

        assert_eq!(first, "assets/screenshot.png");
        assert_eq!(second, "assets/screenshot-2.png");
        assert_eq!(fs::read(root.join(first)).unwrap(), b"abc");
        assert_eq!(fs::read(root.join(second)).unwrap(), b"def");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exports_markdown_with_referenced_general_attachments() {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("tanwords-localdocs-export-assets-{suffix}"));
        let destination = std::env::temp_dir().join(format!("tanwords-localdocs-export-dest-{suffix}"));
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(root.join("assets/archive.zip"), b"zip-data").unwrap();
        fs::write(
            root.join("notes/Guide.md"),
            "[Download](../assets/archive.zip)",
        ).unwrap();

        let count = localdocs_export(
            root.to_string_lossy().to_string(),
            vec!["notes/Guide.md".into()],
            destination.to_string_lossy().to_string(),
        ).unwrap();

        assert_eq!(count, 1);
        assert_eq!(fs::read_to_string(destination.join("Guide.md")).unwrap(), "[Download](./assets/archive.zip)");
        assert_eq!(fs::read(destination.join("assets/archive.zip")).unwrap(), b"zip-data");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(destination).unwrap();
    }
}
