//! Makes cargo notice when the embedded renderer changes.
//!
//! `rust-embed` bakes `app/out/renderer` into the release binary at compile
//! time, but a derive macro cannot emit cargo directives — so without this
//! file, rebuilding the frontend and re-running `cargo build --release` prints
//! "Finished" in half a second and produces a binary still serving the
//! *previous* UI. That failure is silent, survives a deploy, and looks like a
//! caching bug from the outside.
//!
//! `cargo:rerun-if-changed` on the directory alone is not enough: cargo checks
//! a directory's own mtime, which moves when entries are added or removed but
//! not when a file's contents change — and a rebuilt SPA usually reuses the
//! same `index.html` name. So every file is listed individually.

use std::path::Path;

const RENDERER: &str = "../../app/out/renderer";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let renderer = Path::new(RENDERER);
    if !renderer.is_dir() {
        // rust-embed's own error for a missing folder does not say how to
        // produce it, and "build the frontend first" is the entire answer.
        println!(
            "cargo:warning={RENDERER} does not exist — build the frontend first \
             (cd app && bun run build), or use `make build` from web/."
        );
        return;
    }

    watch(renderer);
}

/// Emits `rerun-if-changed` for every file under `dir`, depth-first.
fn watch(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            watch(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}
