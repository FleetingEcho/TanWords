use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;

use super::{json_error, UserSession, WebState};

/// Shape compatible with what the desktop's DataSection reads: the live
/// descriptor. Local vs. Postgres and enable/disable/rotate live under
/// `/api/db/postgres/*` (see `server::postgres_remote`).
pub(super) async fn db_profile(
    State(state): State<WebState>,
    axum::Extension(session): axum::Extension<UserSession>,
) -> Response {
    let runtime = match state.runtime_for(&session).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    match dispatch(&runtime.ctx, "db_get_connection", Args::new(Value::Null)).await {
        Ok(connection) => Json(json!({ "connection": connection })).into_response(),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}
