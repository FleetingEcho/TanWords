Implemented the Documents (文档) area and the More/Settings (更多/设置) area end-to-end for `mobile_tanwords`.

**Documents area**
- `src/db/documents.ts` — ports desktop `documents/crud.rs` with the same SQL: `db_get_documents` (FTS5 `MATCH` search via `documents_fts` + bm25 + snippets, desktop shelf ordering `protected ASC, pinned DESC, sort`), `db_get_document`, `db_create_document`, `db_update_document`, `db_delete_document` (sweeps `document_assets`), `db_get_all_tags`, plus a standalone `db_set_document_pinned`.
- `app/(tabs)/docs.tsx` — 300 ms-debounced FTS SearchBar, FlashList with pinned icons/snippets/UTC-aware timestamps, long-press row actions (pin/delete with confirm), header new-doc button, skeletons, pull-to-refresh, empty state.
- `app/doc/[id].tsx` — markdown editor: 500 ms debounced autosave (+unmount flush on back), KeyboardAvoidingView, 预览 toggle backed by a dependency-free renderer (`src/components/docs/Markdown.tsx`: headings/bold/italic/code/lists/quotes/hr), word-count + updated-at footer, delete with confirm. Protected (desktop-encrypted) docs show a locked notice and are never written.
- Content decision (per v1 scope): plain markdown text is written to both `content` and `content_text`; desktop BlockNote docs load via `content_text` and demote to plaintext on save. `word_count` = CJK chars + latin words (字数 semantics).

**More/Settings area**
- `more.tsx` — iOS-grouped hub: 设置 → `/settings`, AI 对话 with inline 即将推出 expander, version (expo-constants), schema version `actual / expected`, DB path (task-sanctioned in-screen introspection, try/catch).
- `settings/` — hub, appearance (follow-system/light/dark, persists `theme_mode` + instant `setState` switch), TTS speed (0.75–1.5×, persists `tts_speed`), AI providers: list/add/edit/delete over `aiProviderList/Upsert/Delete` with keys going to SecureStore only (never echoed, "已保存，重新输入以更换" placeholder), kind-prefilled defaults.
- i18n: 5 keys added to documents dicts (zh+en), 27 keys to settings dicts (zh+en); reused existing keys wherever they existed.

**Validation**: `bunx tsc --noEmit` — zero errors in all owned files. The repo-wide run shows one error in `src/services/player.ts` which belongs to the parallel Feeds agent and was deliberately left untouched.