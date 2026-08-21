use std::collections::HashMap;
use std::path::{Path, PathBuf};

use regex::Regex;

// The `sherpa-onnx` crate links its native libraries statically, so nothing
// TTS-related has to be staged into the bundle or found via rpath at runtime.
// The previous `sherpa-rs` dependency did neither: it left the sherpa-onnx and
// onnxruntime dylibs in an OS cache dir, which forced this build script to copy
// them into `sherpa-libs/` and to inject platform-specific rpaths so the shipped
// app could locate them. All of that is gone with static linking.
fn main() {
    generate_dispatch_table();
}

// ---------------------------------------------------------------------------
// dispatch table generation
//
// Ported from the former `scripts/gen_dispatch.py` (deleted — this crate has
// no Python anywhere in it). Scans every `.rs` file under `src/` for
// `#[tauri::command]` / `#[shim::command]` / `#[crate::shim::command]`
// annotated functions, works out each one's signature, and emits one match
// arm per command name listed in `scripts/commands.txt` that:
//
//   * deserializes the JSON body into the function's data parameters,
//   * injects State/AppHandle parameters from the shared Ctx,
//   * awaits the call if the fn is async, or spawn_blocking's it if it was
//     `#[tauri::command(async)]`,
//   * serializes the Ok value back to JSON.
//
// Unlike the Python script, this runs on every `cargo build`/`cargo check`
// and writes to `$OUT_DIR/dispatch.rs` rather than a checked-in source file
// — regeneration is automatic, there is no manual step. If a command fails
// to parse, it's printed under UNPARSED via `cargo:warning=` and skipped
// rather than emitting something that silently misbehaves — handle those by
// hand in `src/rpc/manual.rs`.

/// Commands that do NOT move to Rust — they are reimplemented in the
/// Electron main process and never reach the sidecar. See the migration
/// plan, section 5.
const SKIP_MODULES: &[&str] = &["browser_panel"];

struct CommandInfo {
    module: String,
    is_async: bool,
    /// `#[tauri::command(async)]` — run via `spawn_blocking` rather than awaited.
    blocking: bool,
    is_result: bool,
    /// (kind, name) where kind is `state:<Type>`, `app`, `window` or `data`.
    params: Vec<(String, String)>,
}

fn generate_dispatch_table() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=scripts/commands.txt");

    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src_dir = crate_dir.join("src");

    let cmd_attr = Regex::new(r"#\[(?:tauri|shim|crate::shim)::command(?:\(([^)]*)\))?\]").unwrap();
    // Generic parameters exist only to carry `R: tauri::Runtime`; they
    // disappear with the shim, but the regex has to tolerate them while
    // they are still there.
    let fn_sig = Regex::new(r"pub\s+(async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(").unwrap();
    // Matches `Result<..>` as well as fully-qualified spellings like
    // `std::result::Result<..>`.
    let result_re = Regex::new(r"(^|::)Result\s*<").unwrap();

    let mut files = Vec::new();
    collect_rs_files(&src_dir, &mut files);
    files.sort();

    let mut by_name: HashMap<String, CommandInfo> = HashMap::new();
    let mut parent_cache: HashMap<String, String> = HashMap::new();

    for path in &files {
        let body = std::fs::read_to_string(path).unwrap_or_default();

        let rel = path.strip_prefix(&src_dir).unwrap();
        // Windows hands back `localdocs\import_export.rs`; every step below
        // (and resolve_public_module) assumes `/` as the separator, so a
        // backslash would survive straight into the generated `localdocs\
        // import_export::…` paths and fail the compile.
        let mut module = rel.to_string_lossy().replace('\\', "/").replace(".rs", "");
        if let Some(stripped) = module.strip_suffix("/mod") {
            module = stripped.to_string();
        }
        module = module.replace('/', "::");
        let pub_module = resolve_public_module(&module, &src_dir, &crate_dir, &mut parent_cache);

        for caps in cmd_attr.captures_iter(&body) {
            let whole = caps.get(0).unwrap();
            let flags = caps.get(1).map(|g| g.as_str().trim().to_string()).unwrap_or_default();

            let Some(sig_caps) = fn_sig.captures_at(&body, whole.end()) else { continue };
            let sig_whole = sig_caps.get(0).unwrap();
            if sig_whole.start() > whole.end() + 400 {
                continue;
            }

            let params_start = sig_whole.end() - 1; // index of the opening paren
            let (params_text, params_end) = read_params(&body, params_start);
            let return_type = parse_return_type(&body, params_end);
            let name = sig_caps.get(2).unwrap().as_str().to_string();
            let is_async = sig_caps.get(1).is_some();

            let params: Vec<(String, String)> = split_params(&params_text)
                .into_iter()
                .filter(|p| !p.trim().is_empty())
                .map(|p| classify(&p))
                .collect();

            by_name.insert(
                name,
                CommandInfo {
                    module: pub_module.clone(),
                    is_async,
                    blocking: flags == "async",
                    is_result: result_re.is_match(&return_type),
                    params,
                },
            );
        }
    }

    let wanted: Vec<String> = std::fs::read_to_string(crate_dir.join("scripts/commands.txt"))
        .expect("failed to read scripts/commands.txt")
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let mut arms: Vec<String> = Vec::new();

    let mut names: Vec<String> = Vec::new();
    let mut unparsed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    // Feature-aware command filtering. The heavy modules are compiled out
    // when their feature is off, so their commands cannot appear in the
    // dispatch table either — a generated arm naming `tts::engine::..` would
    // not compile in that configuration.
    // `localdocs` stays compiled for every build (Tauri-era local-docs
    // folder utilities), but its filesystem-walking commands must not be
    // reachable from the network-facing web server. That used to be inferred
    // as "neither tts nor audio is on" — a proxy that broke the moment the
    // web build started enabling `tts`/`asr` for the voice assistant — so it
    // now reads the `web` marker feature directly instead of guessing from
    // unrelated ones.
    let has_tts = std::env::var("CARGO_FEATURE_TTS").is_ok();
    let has_asr = std::env::var("CARGO_FEATURE_ASR").is_ok();
    let has_audio = std::env::var("CARGO_FEATURE_AUDIO").is_ok();
    let is_server_build = std::env::var("CARGO_FEATURE_WEB").is_ok();

    for entry in &wanted {
        let (module, name) = match entry.rfind("::") {
            Some(idx) => (&entry[..idx], &entry[idx + 2..]),
            None => ("", entry.as_str()),
        };
        let top = module.split("::").next().unwrap_or("");
        if SKIP_MODULES.contains(&top)
            || (!has_tts && top == "tts")
            || (!has_asr && top == "asr")
            || (!has_audio && (top == "native_audio" || top == "music"))
            || (is_server_build && top == "localdocs")
        {
            skipped.push(entry.clone());
            continue;
        }

        let Some(info) = by_name.get(name) else {
            unparsed.push(entry.clone());
            continue;
        };

        let mut args: Vec<String> = Vec::new();
        let mut binds: Vec<String> = Vec::new();
        let mut takes_window = false;
        for (kind, pname) in &info.params {
            if let Some(ty) = kind.strip_prefix("state:") {
                args.push(format!("ctx.state::<{ty}>()"));
            } else if kind == "app" {
                args.push("ctx.app()".to_string());
            } else if kind == "window" {
                unparsed.push(format!("{entry}  (takes a Window)"));
                takes_window = true;
                break;
            } else {
                binds.push(format!(
                    "        let {pname} = args.take(\"{pname}\").map_err(|e| format!(\"{name}: bad argument `{pname}`: {{e}}\"))?;"
                ));
                args.push(pname.clone());
            }
        }
        if takes_window {
            continue;
        }

        let mut call = format!("{}::{name}({})", info.module, args.join(", "));
        if info.is_async {
            call.push_str(".await");
        } else if info.blocking {
            call = format!(
                "tokio::task::spawn_blocking(move || {call}).await.map_err(|e| e.to_string())?"
            );
        }
        // Only Result-returning commands get the trailing `?` — a few
        // (db_forget_saved_profile, mcp_generate_token, ...) return their
        // value directly.
        let trailing = if info.is_result { "?" } else { "" };
        let body = binds.join("\n");
        names.push(name.to_string());
        arms.push(format!(
            "    \"{name}\" => {{\n{body}\n        let out = {call}{trailing};\n        Ok(serde_json::to_value(out).map_err(|e| e.to_string())?)\n    }}"
        ));
    }

    let mut header = String::from(
        "// GENERATED by build.rs — do not edit by hand.\n\
// Regenerated automatically on every `cargo build`/`cargo check`.\n\
\n\
use crate::rpc::{Args, Ctx};\n\
use serde_json::Value;\n\
// Command modules are referenced bare below (e.g. `db::settings::..`,\n\
// `AppState`) exactly as their own source files spell them — this glob plus\n\
// the explicit imports below put those bare names in scope for this module\n\
// too, without hand-rewriting every generated call site.\n\
#[allow(unused_imports)]\n\
use crate::*;\n\
#[allow(unused_imports)]\n\
use crate::mcp::McpController;\n",
    );
    // Only importable when the `audio` feature is enabled — in server builds
    // the module does not exist and this line would fail the compile.
    if has_audio {
        header.push_str("#[allow(unused_imports)]\nuse crate::native_audio::NativeAudioState;\n");
    }
    header.push_str(
        "\npub async fn dispatch(ctx: &Ctx, command: &str, mut args: Args) -> Result<Value, String> {\n    #[allow(unused_mut, unused_variables)]\n    match command {\n",
    );
    let footer = "\n    other => Err(format!(\"unknown command `{other}`\")),\n    }\n}\n";

    // Emitted alongside the dispatcher so a *caller* can enumerate what this
    // build exposes. The web server's allowlist test walks it and fails on any
    // command it has not explicitly classified — which is what stops a new
    // core command from reaching the public internet by default.
    let names_const = format!(
        "\n/// Every command name in this build's dispatch table.\npub const COMMAND_NAMES: &[&str] = &[\n{}\n];\n",
        names.iter().map(|n| format!("    \"{n}\",")).collect::<Vec<_>>().join("\n")
    );

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR not set");
    let out_path = PathBuf::from(&out_dir).join("dispatch.rs");
    let contents = format!("{header}{}{footer}{names_const}", arms.join(",\n"));
    std::fs::write(&out_path, contents).expect("failed to write dispatch.rs");

    println!("cargo:warning=dispatch: generated {} commands -> {}", arms.len(), out_path.display());
    println!(
        "cargo:warning=dispatch: skipped {} (Electron-main or feature-gated modules): {}",
        skipped.len(),
        skipped.join(", ")
    );
    if !unparsed.is_empty() {
        println!("cargo:warning=dispatch: UNPARSED — port these by hand into src/rpc/manual.rs:");
        for u in &unparsed {
            println!("cargo:warning=dispatch:   {u}");
        }
    }
}

/// Splits a parameter list on top-level commas (generics contain commas).
fn split_params(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut cur = String::new();
    for ch in text.chars() {
        match ch {
            '<' | '(' | '[' => depth += 1,
            '>' | ')' | ']' => depth -= 1,
            _ => {}
        }
        if ch == ',' && depth == 0 {
            out.push(cur.trim().to_string());
            cur = String::new();
        } else {
            cur.push(ch);
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// Returns the text inside the parameter parens starting at `start` (the
/// byte index of the opening paren) and the index just past the closing
/// paren.
fn read_params(body: &str, start: usize) -> (String, usize) {
    let bytes = body.as_bytes();
    let mut depth = 0i32;
    let mut i = start;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return (body[start + 1..i].to_string(), i + 1);
                }
            }
            _ => {}
        }
        i += 1;
    }
    panic!("unbalanced parens in command signature");
}

/// (kind, name) where kind is `state:<Type>`, `app`, `window` or `data`.
fn classify(param: &str) -> (String, String) {
    let (name, ty) = match param.find(':') {
        Some(idx) => (param[..idx].trim().to_string(), param[idx + 1..].trim().to_string()),
        None => (param.trim().to_string(), String::new()),
    };
    if let Some(pos) = ty.find("State<") {
        let inner_start = pos + 6;
        if let Some(end) = ty.rfind('>') {
            if end > inner_start {
                let inner = &ty[inner_start..end];
                let last = inner.rsplit(',').next().unwrap_or("").trim();
                return (format!("state:{last}"), name);
            }
        }
    }
    if ty.contains("AppHandle") {
        return ("app".to_string(), name);
    }
    if ty.contains("Window") || ty.contains("Webview") {
        return ("window".to_string(), name);
    }
    ("data".to_string(), name)
}

/// Text between the parameter list's closing paren and the function body's
/// opening brace, i.e. the ` -> Foo` part (empty for `()`/no arrow). Assumes
/// the return type itself contains no `{` (true for every command here — no
/// trait objects or closures in a command's return position).
fn parse_return_type(body: &str, after: usize) -> String {
    let Some(brace_rel) = body[after..].find('{') else { return String::new() };
    let brace = after + brace_rel;
    let segment = &body[after..brace];
    if !segment.contains("->") {
        return String::new();
    }
    segment.splitn(2, "->").nth(1).unwrap_or("").trim().to_string()
}

fn parent_source(
    prefix: &[String],
    src_dir: &Path,
    crate_dir: &Path,
    cache: &mut HashMap<String, String>,
) -> String {
    let key = prefix.join("::");
    if let Some(v) = cache.get(&key) {
        return v.clone();
    }
    let text = if prefix.is_empty() {
        std::fs::read_to_string(crate_dir.join("src").join("lib.rs")).unwrap_or_default()
    } else {
        let mut mod_rs = src_dir.to_path_buf();
        for p in prefix {
            mod_rs.push(p);
        }
        mod_rs.push("mod.rs");

        let mut file_rs = src_dir.to_path_buf();
        for p in &prefix[..prefix.len() - 1] {
            file_rs.push(p);
        }
        file_rs.push(format!("{}.rs", prefix[prefix.len() - 1]));

        if mod_rs.exists() {
            std::fs::read_to_string(&mod_rs).unwrap_or_default()
        } else if file_rs.exists() {
            std::fs::read_to_string(&file_rs).unwrap_or_default()
        } else {
            String::new()
        }
    };
    cache.insert(key, text.clone());
    text
}

/// Most submodules in this crate are private (`mod x;`) and re-exported at
/// their parent via `pub use x::*;` — e.g. `db_get_document` lives in
/// `db/documents/crud.rs` but is only reachable from outside as
/// `db::documents::db_get_document`, because `crud` itself is private. The
/// physical file path the generator starts from doesn't know that, so walk
/// back up dropping any trailing segment that its parent declares as a
/// private `mod`, stopping at the first segment declared `pub mod` (or when
/// visibility can't be determined, to avoid guessing wrong).
fn resolve_public_module(
    module: &str,
    src_dir: &Path,
    crate_dir: &Path,
    cache: &mut HashMap<String, String>,
) -> String {
    let mut parts: Vec<String> = module.split("::").map(String::from).collect();
    while parts.len() > 1 {
        let leaf = parts.last().unwrap().clone();
        let prefix = parts[..parts.len() - 1].to_vec();
        let parent_src = parent_source(&prefix, src_dir, crate_dir, cache);

        let pub_re = Regex::new(&format!(r"(?m)^\s*pub\s+mod\s+{}\s*;", regex::escape(&leaf))).unwrap();
        if pub_re.is_match(&parent_src) {
            break;
        }
        let priv_re = Regex::new(&format!(r"(?m)^\s*mod\s+{}\s*;", regex::escape(&leaf))).unwrap();
        if priv_re.is_match(&parent_src) {
            parts.pop();
            continue;
        }
        break;
    }
    parts.join("::")
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}
