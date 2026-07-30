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
