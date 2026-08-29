use std::fs;
use std::path::Path;

use super::paths::{ensure_md, resolve};

#[crate::shim::command(async)]
pub fn localdocs_read(root: String, rel_path: String) -> Result<String, String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read: {e}"))
}

#[crate::shim::command(async)]
pub fn localdocs_write(root: String, rel_path: String, content: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write: {e}"))
}

/// Create an empty markdown file in a vault directory, deduplicating the name
/// ("Untitled.md" → "Untitled 2.md"). Returns the new file's relative path.
#[crate::shim::command(async)]
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

/// Creates a directory (and any missing parents) inside the mounted root.
///
/// `localdocs_create` deliberately refuses to invent a parent for a file, so
/// picking "put it in a new folder" needs the folder to exist first — this is
/// what the destination picker calls before it creates the file.
#[crate::shim::command(async)]
pub fn localdocs_create_folder(root: String, path: String) -> Result<String, String> {
    let rel = path.trim().trim_matches('/').to_string();
    if rel.is_empty() {
        return Err("Folder name is empty".into());
    }
    // `resolve` is what keeps a `..` from escaping the mounted root.
    let target = resolve(&root, &rel)?;
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create folder: {e}"))?;
    Ok(rel)
}

/// Renames a directory inside the mounted root, carrying its contents.
/// `new_name` is a leaf name, not a path, so a rename can never relocate the
/// folder by accident — moving one is a drag, same as for a file.
#[crate::shim::command(async)]
pub fn localdocs_rename_folder(
    root: String,
    rel_path: String,
    new_name: String,
) -> Result<String, String> {
    let stem = new_name.trim();
    if stem.is_empty() || stem.contains(['/', '\\']) {
        return Err(format!("Invalid folder name: {new_name}"));
    }
    let current = rel_path.trim().trim_matches('/').to_string();
    if current.is_empty() {
        return Err("Cannot rename the mounted folder itself".into());
    }
    let parent = match current.rfind('/') {
        Some(index) => &current[..index],
        None => "",
    };
    let target_rel = if parent.is_empty() {
        stem.to_string()
    } else {
        format!("{parent}/{stem}")
    };
    let from = resolve(&root, &current)?;
    let to = resolve(&root, &target_rel)?;
    if !from.is_dir() {
        return Err("Folder does not exist".into());
    }
    if to.exists() && !super::paths::same_existing_entry(&from, &to) {
        return Err("A folder with that name already exists".into());
    }
    fs::rename(&from, &to).map_err(|e| format!("Failed to rename folder: {e}"))?;
    Ok(target_rel)
}

/// Deletes a directory inside the mounted root, with everything under it.
/// Unlike the library\'s folders — where removing one keeps its documents and
/// moves them up — this is the filesystem, and half-deleting a directory by
/// scattering its files into the parent would surprise anyone who also opens
/// this vault in a file manager.
#[crate::shim::command(async)]
pub fn localdocs_delete_folder(root: String, rel_path: String) -> Result<(), String> {
    let rel = rel_path.trim().trim_matches('/').to_string();
    if rel.is_empty() {
        return Err("Cannot delete the mounted folder itself".into());
    }
    let target = resolve(&root, &rel)?;
    if !target.is_dir() {
        return Err("Folder does not exist".into());
    }
    fs::remove_dir_all(&target).map_err(|e| format!("Failed to delete folder: {e}"))
}

/// Move one markdown file into an existing directory inside the mounted root.
/// Returns the file's new relative path and never overwrites an existing file.
#[crate::shim::command(async)]
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
#[crate::shim::command(async)]
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
    if new_path.exists() && !super::paths::same_existing_entry(&path, &new_path) {
        return Err("A file with the same name already exists".into());
    }
    fs::rename(&path, &new_path).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(new_rel)
}

#[crate::shim::command(async)]
pub fn localdocs_delete(root: String, rel_path: String) -> Result<(), String> {
    let path = resolve(&root, &rel_path)?;
    ensure_md(&path)?;
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {e}"))
}
