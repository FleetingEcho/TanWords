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
    // Never fall back to an unchecked name — the old `{stem}-copy` fallback
    // silently overwrote an existing file when all 999 candidates were taken.
    dir.join(format!("{}-{}.{}", stem, uuid::Uuid::new_v4(), ext))
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
    let candidate = root_p.join(rel_p);

    // The lexical checks above can't catch a *symlink inside the vault*
    // pointing outside it (synced folders, unzipped archives) — every command
    // here promises "cannot escape the root", so enforce it physically:
    // canonicalize the root and the target's nearest existing ancestor (the
    // target itself may legitimately not exist yet on create/write paths).
    let canon_root = std::fs::canonicalize(root_p)
        .map_err(|e| format!("Invalid mounted directory: {e}"))?;
    let mut probe: &Path = &candidate;
    loop {
        match std::fs::canonicalize(probe) {
            Ok(canon) => {
                if !canon.starts_with(&canon_root) {
                    return Err(format!("Path escapes the mounted directory: {rel}"));
                }
                break;
            }
            Err(_) => match probe.parent() {
                // Climb toward the root until something exists. rel_p had no
                // `..`/prefix, so the walk cannot pass above root_p, and
                // root_p itself canonicalizes (checked above) — the loop
                // always terminates inside the vault.
                Some(p) => probe = p,
                None => break,
            },
        }
    }
    Ok(candidate)
}

pub(super) fn ensure_md(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") => {
            Ok(())
        }
        _ => Err("Only .md files can be used".into()),
    }
}

/// Whether two paths refer to the same *existing* entry. On a
/// case-insensitive filesystem (macOS, Windows), the target of a case-only
/// rename "exists" because it *is* the source — this is how callers tell
/// that apart from a genuine collision.
pub(super) fn same_existing_entry(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}
