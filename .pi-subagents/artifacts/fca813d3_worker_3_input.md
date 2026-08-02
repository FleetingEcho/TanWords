# Task for worker

[Read from: /home/zteng/work/Tools/TanWords/context.md, /home/zteng/work/Tools/TanWords/plan.md]

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
You are building the Documents (文档) area and the More/Settings (我的/设置) area of the TanWords mobile app.

PROJECT: /home/zteng/work/Tools/TanWords/mobile_tanwords (Expo SDK 57, expo-router, NativeWind v4, strict TS, bun).
DESKTOP SPEC (read-only reference, NEVER edit anything under /home/zteng/work/Tools/TanWords/app or outside mobile_tanwords): ../app/src/components/Documents/**, ../app/src/components/Settings/**, ../app/core/src/db/documents/**, ../app/core/src/document_privacy/**.

MANDATORY FIRST STEPS: read mobile_tanwords docs/UX-CONVENTIONS.md (binding), AGENTS.md, PLAN.md (§5 mapping, §6 documents/settings rows, D8), src/components/ui.tsx, app/(tabs)/index.tsx (exemplar), src/db/settings.ts, src/db/providers.ts, src/services/secrets.ts, src/store/settingsStore.ts, src/i18n/zh/settings.ts + documents.ts (existing keys), src/db/schema.sql (grep CREATE TABLE documents/document_assets), then desktop ../app/core/src/db/documents/** for the SQL to port — skip BlockNote-specific block JSON handling: mobile v1 stores markdown/plain text in the same content columns (note in report).

YOUR OWNED FILES:
- CREATE: app/doc/[id].tsx, app/settings/index.tsx, app/settings/appearance.tsx, app/settings/ai.tsx, app/settings/tts.tsx, src/db/documents.ts, src/components/docs/**
- EDIT: app/(tabs)/docs.tsx (placeholder), app/(tabs)/more.tsx (placeholder), src/i18n/zh/documents.ts, src/i18n/en/documents.ts, src/i18n/zh/settings.ts, src/i18n/en/settings.ts (append keys only)

BUILD:
1. src/db/documents.ts — port desktop documents commands 1:1 (same SQL, same function names db_* where reasonable): list (pinned first, then updated_at desc), create, update (title/content), delete, FTS5 search (use the fts query helper pattern from src/db/reading.ts ftsMatchQuery), tags, pin toggle. READ schema.sql first for exact columns; do not invent.
2. app/(tabs)/docs.tsx — Screen + ScreenHeader(t documents title) + SearchBar (debounced, FTS) + FlashList: ListRow per doc (title, updated date muted, snippet when searching, pin icon); new-doc button in header right (icon create-outline) → create blank doc → router.push(`/doc/${id}`); pull-refresh; skeletons; EmptyState.
3. app/doc/[id].tsx — editor: header with back (autosave on back), title TextInput (17px semibold, borderless), divider, body multiline TextInput (15px, lineHeight 24, textAlignVertical top, flex-1) with 500ms debounced autosave; footer meta bar: word count + 字数 + updated time; KeyboardAvoidingView; a 预览 toggle that swaps to a tiny built-in markdown renderer (support # ## ###, **bold**, *italic*, - lists, > quote, `code` inline — implement with string splitting + styled Text, no deps); delete via header trash icon + Alert confirm.
4. app/(tabs)/more.tsx — Screen + ScreenHeader(更多/Settings title) + grouped Card ListRows (chevron, icons): 设置 → /settings, AI 对话 → inline expanding row showing 即将推出 (keep minimal, no route), 关于 → version row (expo-constants version, no nav), 数据库信息 row showing DB path + schema version from your settings (use src/db/connection EXPECTED_SCHEMA_VERSION + actual SELECT max(version) FROM schema_migrations wrapped in try). Group rows with section spacing per iOS settings aesthetic.
5. app/settings/index.tsx — hub ListRows: 外观 → appearance, TTS 语速 → tts, AI 服务 → ai; header back.
   - appearance.tsx: 主题 SegmentedTabs [跟随系统/浅色/深色] bound to settingsStore themeMode — write via settingsStore.setSetting('theme_mode', v) AND update store state so theme switches instantly (read how store slices are structured and add a small setter INSIDE YOUR AREA? No — settingsStore is locked. Workaround: call the store's setState action directly from settings screen: useSettingsStore.setState({themeMode: v}) after persisting via setSetting — that is allowed since it doesn't edit the file).
   - tts.tsx: speed options 0.75/1/1.25/1.5 as ListRows w/ checkmark; persist via settingsStore.setSetting('tts_speed', String(v)) + setState({ttsSpeed: v}).
   - ai.tsx: provider list from src/db/providers.ts + src/services/secrets.ts: rows name + type + model + has-key icon; add/edit sheet (Modal per conventions): fields 名称/类型(anthropic|openai|custom)/base_url/默认模型/API Key → key goes to SecureStore ONLY (never echo back; editing shows placeholder 已保存，重新输入以更换); delete with Alert confirm. Follow PLAN.md D8 sentinel approach already in providers.ts — READ providers.ts first and conform to its exact API.

QUALITY GATES: conventions doc compliance; keyboard-safe layouts; instant theme switching; bunx tsc --noEmit = exit 0 in mobile_tanwords.

FINAL REPORT: files created/edited, i18n keys, documents content-format decision, settings behaviors, blockers (esp. providers/secrets API mismatch).

---
Update progress at: /home/zteng/work/Tools/TanWords/.pi-subagents/artifacts/progress/fca813d3/progress.md

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```