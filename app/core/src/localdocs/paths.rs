use std::path::{Component, Path, PathBuf};

pub(super) fn unique_md_path(dir: &Path, file_name: &str) -> PathBuf {
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

pub(super) fn unique_asset_path(dir: &Path, file_name: &str) -> PathBuf {
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

pub(super) fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
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

pub(super) fn ensure_md(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") => {
            Ok(())
        }
        _ => Err("Only .md files can be used".into()),
    }
}
