use std::path::PathBuf;

use axum::extract::multipart::MultipartError;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use tanwords_lib::db::connection::DbProfile;
use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;
use tanwords_lib::AppState;

use super::{json_error, UserSession, WebState};

/// Hard ceiling on a single import upload. The route disables axum's body
/// limit (a genuine backup can be hundreds of MB), so this is the only thing
/// standing between a logged-in user and the disk.
const MAX_UPLOAD_BYTES: u64 = 512 * 1024 * 1024;

// ── import / export without OS file dialogs ───────────────────────────────

/// Desktop flow: user picks a file in a native dialog, then the frontend
/// calls `db_import_analyze` / `db_import_apply` with that local path. Web
/// flow: upload the file here first, get back a server-side temp path, then
/// call the very same commands with it.
pub(super) async fn import_upload(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    mut multipart: Multipart,
) -> Response {
    fn sanitize(name: &str) -> String {
        let cleaned: String = name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let cleaned = cleaned.trim_start_matches('.').to_string();
        if cleaned.is_empty() {
            "import.bin".to_string()
        } else {
            cleaned
        }
    }

    // Per user, not one shared folder. `import_step` can then prove a path
    // belongs to *this* caller instead of merely proving it is somewhere under
    // uploads/ — which made cross-user access a matter of learning a uuid
    // rather than a matter of authorization.
    let uploads = uploads_dir(&state, session.user_id);
    if let Err(e) = tokio::fs::create_dir_all(&uploads).await {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("cannot create uploads dir: {e}"),
        );
    }

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => return multipart_error(e),
        };
        if field.name() != Some("file") {
            continue;
        }
        let name = sanitize(field.file_name().unwrap_or("import.bin"));
        let path = uploads.join(format!("{}-{name}", uuid::Uuid::new_v4()));
        let mut file = match tokio::fs::File::create(&path).await {
            Ok(f) => f,
            Err(e) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("cannot write upload: {e}"),
                )
            }
        };
        let mut field = field;
        let mut written: u64 = 0;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    // The route disables axum's body limit because a real
                    // import can be hundreds of MB; that is not the same as
                    // agreeing to write an unbounded stream to disk. Without
                    // this, any logged-in user can fill the volume.
                    written += chunk.len() as u64;
                    if written > MAX_UPLOAD_BYTES {
                        let _ = tokio::fs::remove_file(&path).await;
                        return json_error(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            format!(
                                "upload exceeds the {} MB limit",
                                MAX_UPLOAD_BYTES / 1024 / 1024
                            ),
                        );
                    }
                    if let Err(e) = file.write_all(&chunk).await {
                        let _ = tokio::fs::remove_file(&path).await;
                        return json_error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("upload write failed: {e}"),
                        );
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&path).await;
                    return multipart_error(e);
                }
            }
        }
        return Json(json!({ "path": path.to_string_lossy() })).into_response();
    }
    json_error(StatusCode::BAD_REQUEST, "multipart field `file` missing")
}

/// Where this user's uploads live. Per-user so that "is this path an upload?"
/// and "is this path *your* upload?" are the same question.
fn uploads_dir(state: &WebState, user_id: i64) -> PathBuf {
    state
        .config
        .data_dir
        .join("users")
        .join(user_id.to_string())
        .join("uploads")
}

fn multipart_error(e: MultipartError) -> Response {
    json_error(
        StatusCode::BAD_REQUEST,
        format!("invalid multipart body: {e}"),
    )
}

/// The desktop's import flow runs `db_import_analyze`/`db_import_apply` on a
/// user-picked local path. On web those two commands are blocked from general
/// invoke (they'd read arbitrary server paths) and re-exposed here, validated
/// to only accept paths this server minted under `uploads/`.
pub(super) async fn import_step(
    State(state): State<WebState>,
    Path(step): Path<String>,
    axum::Extension(session): axum::Extension<UserSession>,
    Json(args): Json<Value>,
) -> Response {
    if step != "analyze" && step != "apply" {
        return json_error(StatusCode::NOT_FOUND, "not found");
    }
    let Some(path) = args.get("path").and_then(Value::as_str) else {
        return json_error(StatusCode::BAD_REQUEST, "missing path");
    };
    // This caller's upload directory, not the shared one: proving a path sits
    // under uploads/ proved nothing about whose upload it was.
    let uploads = uploads_dir(&state, session.user_id).canonicalize();
    let candidate = std::path::Path::new(path).canonicalize();
    let (Ok(uploads), Ok(candidate)) = (uploads, candidate) else {
        return json_error(StatusCode::BAD_REQUEST, "unknown upload path");
    };
    if !candidate.starts_with(&uploads) {
        return json_error(StatusCode::FORBIDDEN, "path must be a server-issued upload");
    }
    // The underlying commands take `sourcePath`; our public route spells it
    // `path`. Rewrite before dispatch (Args camelCase→snake_case handles the
    // rest).
    let mut forwarded = args.clone();
    if let Some(obj) = forwarded.as_object_mut() {
        if let Some(v) = obj.remove("path") {
            obj.insert("sourcePath".to_string(), v);
        }
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let command = format!("db_import_{step}");
    match dispatch(&runtime.ctx, &command, Args::new(forwarded)).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

#[derive(Deserialize)]
pub(super) struct ExportQuery {
    source: Option<String>,
}

/// Runs the same VACUUM-based snapshot the desktop's `db_export_backup`
/// performs — only the destination and source are chosen server-side here. The
/// source is a closed enum, never a client path. An optional
/// `X-Export-Password` header requests the encrypted format; kept out of the
/// URL so it cannot end up in access logs. The temp file is deleted as soon
/// as its bytes have been read into the response.
pub(super) async fn export_backup(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
    Query(query): Query<ExportQuery>,
    headers: HeaderMap,
) -> Response {
    let exports = state.config.data_dir.join("exports");
    if let Err(e) = tokio::fs::create_dir_all(&exports).await {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("cannot create exports dir: {e}"),
        );
    }
    let password = headers
        .get("x-export-password")
        .and_then(|v| v.to_str().ok())
        .filter(|p| !p.trim().is_empty());
    let path = exports.join(format!("tanwords-backup-{}.tmp", uuid::Uuid::new_v4()));

    let mut args = json!({ "dest": path.to_string_lossy() });
    if let Some(password) = password {
        args["password"] = Value::from(password);
    }
    let requested = query.source.as_deref().unwrap_or("active");
    if !matches!(requested, "active" | "local" | "turso") {
        return json_error(
            StatusCode::BAD_REQUEST,
            "export source must be `local` or `turso`",
        );
    }
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let active_kind = match runtime.ctx.state::<AppState>().descriptor() {
        Ok(descriptor) => descriptor.kind,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let use_active = requested == "active"
        || (requested == "local" && active_kind == tanwords_lib::db::connection::DbKind::Local)
        || (requested == "turso" && active_kind == tanwords_lib::db::connection::DbKind::Turso);

    let result = if use_active {
        if requested == "turso" {
            if let Err(error) = dispatch(&runtime.ctx, "db_sync_now", Args::new(Value::Null)).await
            {
                return json_error(StatusCode::BAD_REQUEST, error);
            }
        }
        dispatch(&runtime.ctx, "db_export_backup", Args::new(args)).await
    } else {
        let user_dir = state.pool.user_dir(session.user_id);
        let database = if requested == "local" {
            let profile = DbProfile::Local {
                path: user_dir.join("tanwords.db").to_string_lossy().to_string(),
            };
            tanwords_lib::db::connection::open(&profile, None).await
        } else {
            let turso = match state.users.turso_for(session.user_id).await {
                Ok(Some(profile)) => profile,
                Ok(None) => {
                    return json_error(
                        StatusCode::BAD_REQUEST,
                        "No Turso connection is saved for this account",
                    )
                }
                Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
            let profile = DbProfile::Turso {
                path: user_dir
                    .join("turso-replica.db")
                    .to_string_lossy()
                    .to_string(),
                url: turso.url,
            };
            tanwords_lib::db::connection::open(&profile, Some(&turso.token)).await
        };
        match database {
            Ok(database) => {
                let (registry, app) = tanwords_lib::build_state_for(database, None).await;
                let ctx = tanwords_lib::rpc::Ctx::new(registry, app);
                dispatch(&ctx, "db_export_backup", Args::new(args)).await
            }
            Err(error) => Err(error),
        }
    };
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&path).await;
        return json_error(StatusCode::BAD_REQUEST, error);
    }
    let bytes = tokio::fs::read(&path).await;
    let _ = tokio::fs::remove_file(&path).await;
    let Ok(bytes) = bytes else {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "export vanished before it could be served",
        );
    };
    let unix_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let ext = if password.is_some() { "zip" } else { "db" };
    let source_name = if requested == "active" {
        match active_kind {
            tanwords_lib::db::connection::DbKind::Local => "local",
            tanwords_lib::db::connection::DbKind::Turso => "turso",
            tanwords_lib::db::connection::DbKind::Postgres => "postgres",
        }
    } else {
        requested
    };
    let filename = format!("tanwords-{source_name}-backup-{unix_ts}.{ext}");
    (
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response()
}
