# Progress

## Status
Done — Documents area + More/Settings area complete; owned files typecheck clean.

## Tasks
- [x] src/db/documents.ts (port of desktop documents/crud.rs; FTS5 search via documents_fts + ftsMatchQuery; pinned-first shelf order `protected ASC, pinned DESC, sort`)
- [x] app/(tabs)/docs.tsx (Screen+ScreenHeader+SearchBar 300ms debounce, FlashList, long-press pin/delete Alert, new-doc header button, skeletons, pull-refresh, EmptyState)
- [x] app/doc/[id].tsx (500ms debounced autosave + unmount flush, KeyboardAvoidingView, footer 字数/updated bar, 预览 toggle, trash+Alert confirm, locked view for protected docs)
- [x] src/components/docs/Markdown.tsx (dep-free renderer: #/##/###, **bold**, *italic*, `code`, lists, > quote, hr)
- [x] src/components/docs/format.ts (UTC-aware datetime parse, 字数 counter, snippet)
- [x] app/(tabs)/more.tsx (iOS-grouped hub: 设置→/settings, AI 对话 inline 即将推出 expand, version via expo-constants, schema version + DB path)
- [x] app/settings/{index,appearance,tts,ai}.tsx + _header.tsx (non-route shared back header)
- [x] i18n appends zh+en documents.ts (5 keys) + settings.ts (27 keys)
- [x] bunx tsc --noEmit: 0 errors in owned files

## Decisions (reported)
- content format: mobile v1 writes plain markdown into BOTH `content` and `content_text` columns; desktop BlockNote JSON structure is demoted to plaintext when edited on mobile (detected via `^\s*[\[{]`, loads content_text instead). Mobile-created docs open as plain text on desktop.
- word_count = CJK chars + latin words (hybrid 字数), matching desktop "doc.wordCount": "{n} 字" display.
- protected docs: desktop encrypts content+content_text at rest → locked placeholder on mobile (doc.protectedMobile), never written to from the editor. document_privacy NOT ported (v1).
- search: FTS5 MATCH via ftsMatchQuery ("term"* AND …) + bm25 order + snippet guarded to `protected=0`; desktop's fuzzy-LIKE list matching not ported.
- theme/tts settings: persist via settingsStore.setSetting + apply instantly via useSettingsStore.setState (store file is locked/shared — documented workaround from task brief).
- more.tsx runs `SELECT MAX(version) FROM schema_migrations` and reads Paths.document in-screen (task-sanctioned deviation from "no raw SQL in screens", wrapped in try/catch).
- AiProviderRow delete UX: delete lives inside the edit sheet (ListRow has no onLongPress prop and ui.tsx is locked).

## Files Changed
- src/db/documents.ts (new)
- app/(tabs)/docs.tsx (placeholder → full screen)
- app/doc/[id].tsx (new)
- src/components/docs/Markdown.tsx, format.ts (new)
- app/(tabs)/more.tsx (placeholder → full screen)
- app/settings/index.tsx, _header.tsx, appearance.tsx, tts.tsx, ai.tsx (new)
- src/i18n/zh/documents.ts, src/i18n/en/documents.ts (appended)
- src/i18n/zh/settings.ts, src/i18n/en/settings.ts (appended)

## Blockers
- None for my area. tsc shows 1 error in src/services/player.ts (`removeFromLockScreen` on AudioPlayer) — owned by the parallel Feeds agent, intentionally not touched.

## Notes
- ai.tsx kind defaults prefill: anthropic api.anthropic.com / openai api.openai.com/v1 / custom blank; models claude-sonnet-4-5 / gpt-4o-mini as placeholders only.
- New providers get id `p.{Crypto.randomUUID()}`; key omitted on edit ⇒ existing key preserved (providers.ts handles sentinel).
- Untouched locked files; no staged git files.
