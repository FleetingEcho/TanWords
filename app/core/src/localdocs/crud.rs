use std::fs;
use std::path::Path;

use super::paths::{ensure_md, resolve};

#[crate::shim::command]
pub fn localdocs_read(root: String, rel_path: String) -> Result<String, String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read: {e}"))
}

#[crate::shim::command]
pub fn localdocs_write(root: String, rel_path: String, content: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write: {e}"))
}

/// Create an empty markdown file in a vault directory, deduplicating the name
/// ("Untitled.md" → "Untitled 2.md"). Returns the new file's relative path.
#[crate::shim::command]
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
#[crate::shim::command]
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
#[crate::shim::command]
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

#[crate::shim::command]
pub fn localdocs_delete(root: String, rel_path: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {e}"))
}
