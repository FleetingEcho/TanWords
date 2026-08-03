//! Which core commands `/invoke/{command}` will run.
//!
//! An allowlist, not a denylist, and the difference is the whole point. The
//! core's dispatch table is built for a desktop app where the caller is the
//! person who owns the machine; here the caller is whoever holds a session on
//! a box reachable from the internet. Those are different trust models, so
//! "everything the core offers, minus the ones we remembered to remove" is the
//! wrong default — it means every command added to the core in future is
//! published here the moment it merges, by nobody's decision.
//!
//! The test at the bottom walks `COMMAND_NAMES` (emitted by the core's
//! build.rs) and fails on any command that appears in neither list. Adding a
//! command to the core therefore breaks this crate's tests until somebody
//! decides which side it belongs on.

/// Runs on the caller's own per-user runtime, touching only their own database.
const ALLOWED: &[&str] = &[
    // ── vocabulary ────────────────────────────────────────────────────────
    "db_add_known_words",
    "db_add_scene_words_to_vocabulary",
    "db_add_search_history",
    "db_add_word",
    "db_add_word_enriched",
    "db_add_words_batch",
    "db_clear_search_history",
    "db_clear_translations",
    "db_delete_word",
    "db_delete_words_batch",
    "db_get_all_tags",
    "db_get_due_cards",
    "db_get_known_words",
    "db_get_quiz_words",
    "db_get_review_count",
    "db_get_search_history",
    "db_get_translation_count",
    "db_get_translations",
    "db_get_word_count",
    "db_get_word_detail",
    "db_get_word_extras",
    "db_get_words",
    "db_review_card",
    "db_save_quiz_result",
    "db_save_translation",
    "db_save_word_chat",
    "db_save_word_notes",
    "db_set_word_starred",
    // ── sentence patterns ─────────────────────────────────────────────────
    "db_delete_pattern",
    "db_list_patterns",
    "db_save_sentence_pattern",
    "db_set_pattern_starred",
    "db_update_pattern_analysis",
    // ── documents ─────────────────────────────────────────────────────────
    "db_change_document_password",
    "db_create_document",
    "db_create_document_asset",
    "db_create_document_with_content",
    "db_create_remote_asset",
    "db_create_standalone_asset",
    "db_delete_document",
    "db_delete_document_asset",
    "db_delete_orphan_document_assets",
    "db_document_title_exists",
    "db_duplicate_document",
    "db_get_document",
    "db_get_document_asset",
    "db_get_document_assets",
    "db_get_document_link_context",
    "db_get_documents",
    "db_list_document_assets",
    "db_lock_document",
    "db_private_password_status",
    "db_protect_document",
    "db_prune_document_assets",
    "db_remove_document_protection",
    "db_unlock_document",
    "db_update_document",
    // ── reading / RSS / feeds ─────────────────────────────────────────────
    "db_add_reading_comment",
    "db_add_rss_feed",
    "db_delete_reading_article",
    "db_delete_reading_comment",
    "db_delete_rss_feed",
    "db_get_feed_bookmarks",
    "db_get_reading_article",
    "db_get_rss_entries",
    "db_get_rss_feeds",
    "db_get_rss_unread_counts",
    "db_list_reading_articles",
    "db_list_reading_comments",
    "db_mark_rss_entry_read",
    "db_remove_feed_bookmark",
    "db_save_article_analysis",
    "db_save_reading_article",
    "db_sync_rss_feed",
    "db_toggle_feed_bookmark",
    "db_update_rss_feed_preferences",
    "db_update_rss_feed_title",
    // ── scenes ────────────────────────────────────────────────────────────
    "db_finish_scene_session",
    "db_get_scene_lesson",
    "db_get_scene_progress",
    "db_list_scenes",
    "db_save_scene_attempt",
    "db_save_scene_lesson",
    "db_start_scene_session",
    // ── chat sessions ─────────────────────────────────────────────────────
    "db_delete_chat_session",
    "db_get_chat_session",
    "db_list_chat_sessions",
    "db_rename_chat_session",
    "db_search_chat_sessions",
    "db_set_chat_session_archived",
    "db_set_chat_session_pinned",
    "db_upsert_chat_session",
    // ── misc per-user state ───────────────────────────────────────────────
    "db_dashboard_stats",
    "db_get_connection",
    "db_get_db_size",
    "db_get_setting",
    "db_get_startup_warning",
    "db_set_setting",
    "db_sync_now",
    // ── AI provider config (keys stay server-side; see BLOCKED) ───────────
    "ai_provider_delete",
    "ai_provider_list",
    "ai_provider_upsert",
    // ── outbound fetches, SSRF-guarded in core's http_util ────────────────
    "fetch_article",
    "fetch_hn_comments",
    "fetch_hn_section",
    "fetch_rss",
    "search_hn",
    // ── R2 object storage: settings live in the caller's own database ─────
    "r2_connect",
    "r2_disconnect",
    "r2_get_status",
    "r2_get_usage",
    "r2_put_asset",
    "r2_set_always_upload",
];

/// Refused, with the reason attached. Kept as pairs rather than a bare list so
/// that whoever revisits one of these can see what it would cost to allow it.
const BLOCKED: &[(&str, &str)] = &[
    // Global desktop state: one process-wide database connection. Reimplemented
    // per-user by the /api/db/* routes.
    ("db_switch_path", "would repoint the process-wide database"),
    ("db_connect_turso", "per-user replacement lives at /api/db/turso/connect"),
    ("db_disconnect_remote", "per-user replacement lives at /api/db/turso/disconnect"),
    ("db_forget_saved_profile", "per-user replacement lives at /api/db/turso/forget"),
    // NB: the old denylist also carried `db_get_remembered_turso`, which is
    // not in the dispatch table at all — see the note in README. Listing a
    // name that dispatch has never heard of blocks nothing; the stale-entry
    // test below is what surfaced it.
    ("db_saved_profile_is_turso", "per-user replacement lives at /api/db/profile"),
    // Arbitrary server-side filesystem paths. Re-exposed, validated, as the
    // /api/import/* and /api/export/* routes.
    ("db_get_db_path", "exposes server filesystem layout"),
    ("db_export_backup", "writes to an arbitrary server path; see /api/export/backup"),
    ("db_import_analyze", "reads an arbitrary server path; see /api/import/analyze"),
    ("db_import_apply", "reads an arbitrary server path; see /api/import/apply"),
    ("db_export_document_asset", "writes to an arbitrary server path"),
    ("db_export_document_assets_to_folder", "writes to an arbitrary server path"),
    ("db_export_document_assets_zip", "writes to an arbitrary server path"),
    // The secret store is a single file shared by every user of this process.
    ("secret_get", "the secret store is process-wide, not per-user"),
    ("secret_set", "the secret store is process-wide, not per-user"),
    ("secret_delete", "the secret store is process-wide, not per-user"),
    // app_config.json is likewise one file for the whole process: any caller
    // setting the app lock would set it for everybody.
    ("app_lock_set", "the app lock is stored process-wide in app_config.json"),
    ("app_lock_disable", "the app lock is stored process-wide in app_config.json"),
    ("app_lock_status", "the app lock is stored process-wide in app_config.json"),
    ("app_lock_verify", "the app lock is stored process-wide in app_config.json"),
    // Would have this server bind a listener of the caller's choosing. The
    // frontend hides MCP on web (hostCapabilities.mcp = false), but that is a
    // UI decision, and a UI decision is not an authorization boundary.
    ("mcp_apply_config", "would bind a network listener on the server host"),
    ("mcp_generate_token", "MCP is not served on the web build"),
    ("mcp_get_config", "MCP is not served on the web build"),
    // Hands the decrypted provider key to the browser. The whole point of
    // /api/ai-proxy is that the key never has to go there.
    ("ai_provider_key", "returns a plaintext API key; use /api/ai-proxy instead"),
];

/// The gate `/invoke/{command}` consults.
pub fn is_allowed(command: &str) -> bool {
    ALLOWED.contains(&command)
}

/// Why a known-but-refused command was refused, for the error message.
pub fn block_reason(command: &str) -> Option<&'static str> {
    BLOCKED.iter().find(|(name, _)| *name == command).map(|(_, why)| *why)
}

#[cfg(test)]
mod tests {
    use super::{ALLOWED, BLOCKED};
    use tanwords_lib::rpc::dispatch::COMMAND_NAMES;

    /// The guard rail. A command added to the core lands in `COMMAND_NAMES`
    /// automatically; until somebody puts it in one of the two lists above,
    /// this fails — and it is *not* published in the meantime, because
    /// `is_allowed` says no by default.
    #[test]
    fn every_core_command_is_classified() {
        let unclassified: Vec<&str> = COMMAND_NAMES
            .iter()
            .copied()
            .filter(|name| {
                !ALLOWED.contains(name) && !BLOCKED.iter().any(|(blocked, _)| blocked == name)
            })
            .collect();
        assert!(
            unclassified.is_empty(),
            "these core commands are neither allowed nor blocked on the web build — decide, \
             then add them to web/server/src/commands.rs:\n  {}",
            unclassified.join("\n  ")
        );
    }

    /// A name in both lists is an ambiguity that `is_allowed` would silently
    /// resolve in favour of exposure.
    #[test]
    fn no_command_is_both_allowed_and_blocked() {
        let both: Vec<&str> = ALLOWED
            .iter()
            .copied()
            .filter(|name| BLOCKED.iter().any(|(blocked, _)| blocked == name))
            .collect();
        assert!(both.is_empty(), "listed as both allowed and blocked: {both:?}");
    }

    /// Guards against a typo quietly turning into a permanently dead entry —
    /// a blocked name that matches nothing blocks nothing.
    #[test]
    fn every_listed_command_still_exists_in_the_core() {
        let stale: Vec<&str> = ALLOWED
            .iter()
            .copied()
            .chain(BLOCKED.iter().map(|(name, _)| *name))
            .filter(|name| !COMMAND_NAMES.contains(name))
            .collect();
        assert!(
            stale.is_empty(),
            "listed here but absent from the core's dispatch table (renamed or removed?): {stale:?}"
        );
    }
}
