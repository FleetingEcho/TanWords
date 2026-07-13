use std::path::{Path, PathBuf};

fn main() {
    // Must run before tauri_build::build(), which eagerly validates that
    // `bundle.resources` glob patterns already match at least one file.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    stage_sherpa_libs();

    tauri_build::build();

    // sherpa-rs (TTS) dylibs are bundled into Resources/sherpa-libs/ via
    // tauri.conf.json's `bundle.resources` (see sherpa-libs/ above) — Tauri
    // preserves the source glob's relative directory under Resources/ rather
    // than flattening it. Add that directory to the binary's rpath so dyld
    // finds them at runtime.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources/sherpa-libs");

    // On Linux (deb/rpm/AppImage), Tauri lays resources out as
    // usr/lib/<ProductName>/sherpa-libs/ while the binary itself lives in
    // usr/bin/ — a sibling of usr/lib, not a child of the binary's own dir.
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/TanWords/sherpa-libs");
}

/// sherpa-rs-sys downloads/builds the sherpa-onnx + onnxruntime shared
/// libraries into an OS cache dir (`~/Library/Caches/sherpa-rs` on macOS,
/// `$XDG_CACHE_HOME/sherpa-rs` or `~/.cache/sherpa-rs` on Linux) rather than
/// exposing their path to dependent crates. Copy every shared lib found there
/// into a fixed, git-ignored `sherpa-libs/` dir next to this build.rs so
/// `tauri.conf.json`'s `bundle.resources` can reference a stable relative
/// path — otherwise the app links against `@rpath`/`$ORIGIN` libs that never
/// actually ship in the bundle, and crashes on launch on a machine that
/// doesn't have them cached from a prior `cargo build`.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn stage_sherpa_libs() {
    let Some(cache_root) = sherpa_cache_root() else { return };
    if !cache_root.exists() {
        return;
    }

    let dest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sherpa-libs");
    std::fs::create_dir_all(&dest).expect("failed to create sherpa-libs/");

    let mut found = std::collections::HashSet::new();
    let mut stack = vec![cache_root];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !is_shared_lib(&path) {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
            if !found.insert(name.to_string()) {
                continue; // already staged a file with this name
            }
            let _ = std::fs::copy(&path, dest.join(name));
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn is_shared_lib(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    name.contains(".dylib") || name.contains(".so")
}

#[cfg(target_os = "macos")]
fn sherpa_cache_root() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|home| PathBuf::from(home).join("Library/Caches/sherpa-rs"))
}

#[cfg(target_os = "linux")]
fn sherpa_cache_root() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        return Some(PathBuf::from(xdg).join("sherpa-rs"));
    }
    std::env::var("HOME").ok().map(|home| PathBuf::from(home).join(".cache/sherpa-rs"))
}
