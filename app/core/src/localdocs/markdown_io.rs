use std::fs;
use std::path::Path;

use super::paths::{ensure_md, unique_asset_path, unique_md_path};
use super::types::{MarkdownBundleExport, MarkdownExport, MarkdownSource};

#[crate::shim::command]
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

#[crate::shim::command]
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

#[crate::shim::command]
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

#[crate::shim::command]
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
        // Assets are written IMMEDIATELY (not staged) so unique_asset_path
        // sees same-run duplicates on disk — and their final names are known
        // before the markdown is written: several documents can carry
        // same-named attachments (as can an export into a reused folder).
        let mut content = file.content.clone();
        for asset in &file.assets {
            let safe_asset_name = Path::new(&asset.name)
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("Invalid asset name")?;
            let data = STANDARD.decode(&asset.data_base64).map_err(|_| "Invalid asset data")?;
            let dest = unique_asset_path(&assets_dir, safe_asset_name);
            let dest_name = dest
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or("Invalid asset name")?;
            fs::write(&dest, data)
                .map_err(|e| format!("Failed to export image: {e}"))?;
            if dest_name != safe_asset_name {
                content = replace_asset_ref(&content, safe_asset_name, dest_name);
            }
        }
        fs::write(unique_md_path(dir, safe_name), &content)
            .map_err(|e| format!("Failed to export document: {e}"))?;
    }
    Ok(files.len())
}

/// Repoints `assets/<from>` references in exported markdown to `assets/<to>`
/// after a name collision forced a rename. Only replaces where the next
/// character closes the reference (`)`, `"`, `'`, whitespace) so a longer
/// name sharing the prefix (`img.png` vs `img.png.bak`) is never clobbered.
fn replace_asset_ref(content: &str, from: &str, to: &str) -> String {
    let needle_plain = format!("assets/{from}");
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(idx) = rest.find(&needle_plain) {
        let after = idx + needle_plain.len();
        let boundary = rest[after..]
            .chars()
            .next()
            .map(|c| c == ')' || c == '"' || c == '\'' || c.is_whitespace())
            .unwrap_or(true);
        if boundary {
            out.push_str(&rest[..idx]);
            out.push_str(&format!("assets/{to}"));
            rest = &rest[after..];
        } else {
            out.push_str(&rest[..after]);
            rest = &rest[after..];
        }
    }
    out.push_str(rest);
    out
}
