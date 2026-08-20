use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use tanwords_lib::rpc::dispatch::dispatch;
use tanwords_lib::rpc::Args;

use super::{json_error, UserSession, WebState};

fn redact_connection_password(mut connection: Value) -> Value {
    if let Some(remote_url) = connection
        .get("remoteUrl")
        .and_then(Value::as_str)
        .and_then(|raw| url::Url::parse(raw).ok())
    {
        let mut redacted = remote_url;
        let _ = redacted.set_password(None);
        connection["remoteUrl"] = Value::String(redacted.to_string());
    }
    connection
}

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
        Ok(connection) => {
            // A generic profile/status read must never move the live Postgres
            // password into the browser. The explicit reveal route re-checks
            // the account password before returning the full external URL.
            Json(json!({ "connection": redact_connection_password(connection) })).into_response()
        }
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

#[cfg(test)]
mod tests {
    use super::redact_connection_password;
    use serde_json::json;

    #[test]
    fn web_connection_descriptor_never_contains_the_postgres_password() {
        let connection = json!({
            "kind": "postgres",
            "remoteUrl": "postgres://tanwords_user:stored-secret@postgres:5432/tanwords?sslmode=require"
        });

        let redacted = redact_connection_password(connection);
        let url = redacted["remoteUrl"].as_str().unwrap();
        assert!(!url.contains("stored-secret"));
        assert!(url.contains("postgres://tanwords_user@postgres:5432/tanwords"));
    }
}
