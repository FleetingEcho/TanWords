# Task for worker

[Read from: /home/zteng/work/Tools/TanWords/context.md, /home/zteng/work/Tools/TanWords/plan.md]

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
You are building the Reading (精读) area of the TanWords mobile app: paste/URL article import, AI extraction of vocabulary + sentence patterns, accept flow, and the saved-article reader with sentence playback.

PROJECT: /home/zteng/work/Tools/TanWords/mobile_tanwords (Expo SDK 57, expo-router, NativeWind v4, strict TS, bun).
DESKTOP SPEC (read-only reference, NEVER edit anything under /home/zteng/work/Tools/TanWords/app or outside mobile_tanwords): ../app/src/components/Reader/**, ../app/src/hooks/useAnalyzeArticle.ts, ../app/src/lib/sentences.ts, ../app/src/lib/patternFromSentence.ts, ../app/core/src/db/articles.rs and reading.rs.

MANDATORY FIRST STEPS: read mobile_tanwords docs/UX-CONVENTIONS.md (binding), AGENTS.md, PLAN.md (§3, §6 reading row, §7.3–7.4), src/components/ui.tsx, app/(tabs)/index.tsx (exemplar), src/db/reading.ts, src/db/words.ts (db_add_word, db_add_words_batch signatures), src/db/patterns.ts, src/providers/base.ts + anthropic.ts + providerStore.ts + select.ts (how streaming chat is invoked on mobile — reuse this path exactly), src/services/readability.ts, src/services/tts.ts, src/lib/sentences.ts, src/lib/patternFromSentence.ts, src/db/schema.sql (grep CREATE TABLE for articles-related tables to know columns before porting articles.rs).

YOUR OWNED FILES:
- CREATE: app/reading/[id].tsx, src/ai/** (prompt builders/parsers ported from desktop base.ts analyze-related section), src/hooks/useAnalyzeArticle.ts, src/components/reading/**
- CREATE src/db/articles.ts ONLY IF the analysis results persist to article-analysis tables used by useAnalyzeArticle flow (check desktop articles.rs + schema.sql); otherwise put what's needed in reading-area files.
- EDIT: app/(tabs)/reading.tsx (placeholder), src/i18n/zh/reading.ts, src/i18n/en/reading.ts (append only)

BUILD:
1. app/(tabs)/reading.tsx — two states on one screen: (a) home = recent saved articles list (db_list_reading_articles sort recent; FlashList; title, source, word_count, last_read_at; pull-refresh; EmptyState guiding to paste) + prominent top Card with multiline paste TextInput (~5 lines) and buttons: [粘贴] reads expo-clipboard, [分析] starts flow — plus a secondary compact option: paste a URL → fetch text via services/readability.ts then analyze its textContent. (b) in-progress = streaming status card (句子拆分…/AI 提取中 with live count of extracted words/patterns as stream yields, wired like the desktop hook does).
   - Abort control while streaming.
2. Results accept flow (bottom-sheet style Modal, per conventions): two lists — 生词 (word, pos, zh, the sentence it came from) and 句式 (pattern skeleton + example sentence); each row checkbox-style toggle, all selected by default like desktop(? verify from ../app/src Reader accept UI); footer Buttons: 全部加入/加入所选; persistence via db_add_words_batch for words and the matching patterns insert (check src/db/patterns.ts exports for the right add fn; if missing a batch add for patterns, add ONE new exported fn to… NO — patterns.ts is not yours. Instead call whatever exists; if nothing fits, do per-item inserts with existing fns or skip pattern persistence with a clear inline TODO + report it).
   - On success: article saved via db_save_reading_article, sheet dismisses, list refreshes, success haptic notification.
3. app/reading/[id].tsx — saved article reader: header (back, title, speak-all toggle), meta row (source · N words), content = paragraphs split into sentences via src/lib/sentences.ts; tap sentence → mark + show action bar above bottom-safe-area: [朗读单句] (services/tts speak), [翻译] v1 can call provider chat once for that sentence with a compact prompt (Chinese translation, no streaming UI needed — small popover with result + loading), [收录整句为句式…] skip (v2). Speak-all = sequential sentence playback with current-sentence highlight (use tts service queue/callbacks; stop on exit). Long-press word → small lookup sheet: dictionary from words table by exact match if present else 加入生词本 via AI quick explain? Keep v1: exact-match local lookup + 去详情 link to /word/[word], and if absent, +生词 button opening the same AI enrich path the providers support — IF that requires enrichment infra not yet ported, instead persist a bare word via db_add_word with the sentence as context and note in report.
4. src/ai/* + src/hooks/useAnalyzeArticle.ts — port the desktop analyze pipeline faithfully: same prompt text (copy verbatim from ../app/src/providers/base.ts), same response parsing (jsonrepair usage), same temperature/model prefs via providerStore/select. Streaming partial-parse only if desktop does it; otherwise simpler final-parse is acceptable — document choice.

QUALITY GATES: conventions doc; Chinese-first via useT (new keys in zh+en reading.ts); all AI/network errors → inline card with retry, never crash; bunx tsc --noEmit = exit 0 in mobile_tanwords.

FINAL REPORT: files created/edited, i18n keys, analyze pipeline fidelity notes (what was simplified), blockers (esp. provider API mismatch, patterns persistence).

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