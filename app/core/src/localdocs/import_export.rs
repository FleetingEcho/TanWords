use std::fs;
use std::path::Path;

use super::paths::{ensure_md, resolve, unique_asset_path, unique_md_path};

#[crate::shim::command]
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

#[crate::shim::command]
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
