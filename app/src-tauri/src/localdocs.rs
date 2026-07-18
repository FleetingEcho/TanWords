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

#[tauri::command]
pub fn markdown_read_files(paths: Vec<String>) -> Result<Vec<MarkdownSource>, String> {
    let mut out = Vec::new();
    for source in paths {
        let path = Path::new(&source);
        if !path.is_absolute() {
            return Err(format!("非法路径: {source}"));
        }
        ensure_md(path)?;
        let content = fs::read_to_string(path).map_err(|e| format!("读取失败: {e}"))?;
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
        return Err(format!("导出目录无效: {destination}"));
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
            .map_err(|e| format!("导出失败: {e}"))?;
    }
    Ok(files.len())
}

#[tauri::command]
pub fn localdocs_import(root: String, sources: Vec<String>) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err(format!("挂载目录无效: {root}"));
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
        fs::copy(path, &destination).map_err(|e| format!("导入失败: {e}"))?;
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
        return Err(format!("导出目录无效: {}", destination.display()));
    }
    for rel_path in &rel_paths {
        let source = resolve(&root, rel_path)?;
        ensure_md(&source)?;
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.md");
        fs::copy(&source, unique_md_path(destination, name))
            .map_err(|e| format!("导出失败: {e}"))?;
    }
    Ok(rel_paths.len())
}

fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root_p = Path::new(root);
    if !root_p.is_absolute() || !root_p.is_dir() {
        return Err(format!("挂载目录无效: {root}"));
    }
    let rel_p = Path::new(rel);
    if rel_p.is_absolute()
        || rel_p
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(format!("非法路径: {rel}"));
    }
    Ok(root_p.join(rel_p))
}

fn ensure_md(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") => {
            Ok(())
        }
        _ => Err("只能操作 .md 文件".into()),
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
        return Err(format!("挂载目录无效: {root}"));
    }
    let mut out = Vec::new();
    walk(root_p, root_p, 0, &mut out);
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
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
        return Err(format!("挂载目录无效: {root}"));
    }
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(true)
        .fixed_strings(true)
        .build(query)
        .map_err(|e| format!("搜索表达式无效: {e}"))?;
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
    fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))
}

#[tauri::command]
pub fn localdocs_write(root: String, rel_path: String, content: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::write(&path, content).map_err(|e| format!("写入失败: {e}"))
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
        return Err(format!("非法文件名: {name}"));
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
        let parent = path.parent().ok_or("目标文件夹无效")?;
        if !parent.is_dir() {
            return Err("目标文件夹不存在".into());
        }
        if !path.exists() {
            fs::write(&path, "").map_err(|e| format!("创建失败: {e}"))?;
            return Ok(rel_path);
        }
    }
    Err("同名文件过多".into())
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
        return Err("源文件不存在".into());
    }
    let directory = resolve(&root, &target_dir)?;
    if !directory.is_dir() {
        return Err("目标文件夹不存在".into());
    }
    let file_name = source.file_name().ok_or("源文件名无效")?;
    let destination = directory.join(file_name);
    let new_rel = destination
        .strip_prefix(Path::new(&root))
        .map_err(|_| "目标路径无效")?
        .to_string_lossy()
        .to_string();
    if destination == source {
        return Ok(new_rel);
    }
    if destination.exists() {
        return Err("目标文件夹中已存在同名文件".into());
    }
    fs::rename(&source, &destination).map_err(|e| format!("移动失败: {e}"))?;
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
        return Err(format!("非法文件名: {new_name}"));
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
        return Err("同名文件已存在".into());
    }
    fs::rename(&path, &new_path).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(new_rel)
}

#[tauri::command]
pub fn localdocs_delete(root: String, rel_path: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{localdocs_create, localdocs_move};
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
}
