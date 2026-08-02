# Task for worker

[Read from: /home/zteng/work/Tools/TanWords/context.md, /home/zteng/work/Tools/TanWords/plan.md]

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
You are building the Learn (学习) area of the TanWords mobile app.

PROJECT: /home/zteng/work/Tools/TanWords/mobile_tanwords (Expo SDK 57, expo-router, NativeWind v4, strict TS, bun).
DESKTOP SPEC (read-only reference, NEVER edit anything under /home/zteng/work/Tools/TanWords/app or any path outside mobile_tanwords): renderer at ../app/src, Rust db at ../app/core/src.

MANDATORY FIRST STEPS, in order — read these files in mobile_tanwords: docs/UX-CONVENTIONS.md (binding contract for colors/components/i18n/file-ownership), AGENTS.md, src/components/ui.tsx, app/(tabs)/index.tsx (the UX exemplar — match its quality), src/db/words.ts, src/db/patterns.ts, src/db/srs.ts, src/services/tts.ts, src/store/wordModalStore.ts. Then skim ../app/src/components/Vocabulary/ and ../app/src/features/patterns/ for behavioral spec.

YOUR OWNED FILES (do not touch anything else):
- CREATE: app/word/[word].tsx, app/review/index.tsx, src/components/learn/**
- EDIT: app/(tabs)/learn.tsx (currently a placeholder), src/i18n/zh/vocabulary.ts, src/i18n/en/vocabulary.ts (append keys only)

BUILD:
1. app/(tabs)/learn.tsx — Screen + ScreenHeader(title t("vocab.title"), right side: due Badge count) + SegmentedTabs [单词/句式/复习].
   - Words segment: SearchBar (debounced 300ms) + FlashList of db_get_words({search, limit reasonable}); row = word (15px semibold), first zh def (13px muted, 1 line), CEFR level chip, star icon if starred; tap → router.push(`/word/${encodeURIComponent(word)}`); long-press → ActionSheet-ish Modal with 标星/删除 options; pull-to-refresh; FlashList; EmptyState(icon "text-outline") when no words; Skeleton rows on first load.
   - Patterns segment: list from src/db/patterns.ts exports; rows show skeleton text with slots highlighted, star toggle inline; expand row inline to show examples; EmptyState.
   - Review segment: Card with due count (db_get_review_count), explanation line (new cards cap = DEFAULT_NEW_LIMIT/day from srs.ts), primary Button 开始复习 → router.push("/review"); disabled/celebratory state when 0 due.
2. app/word/[word].tsx — word detail as pushed route. Resolve word→id via db_get_words search/exact, then db_get_word_detail + db_get_word_extras. Sections (Cards): headword + phonetic + speak button (src/services/tts.ts speak fn, respect settingsStore ttsSpeed), POS-grouped definitions (zh primary), examples (en sentence + zh), collocations/etymology/mnemonics if present, notes if present. Actions row: star toggle, delete (Alert.confirm → db_delete_word → router.back()). Loading skeleton, not-found EmptyState. Header: native-style row with back chevron + word title + star.
3. app/review/index.tsx — FSRS session screen. On mount load db_get_due_cards(). Card UI: prompt side = word (or pattern skeleton); tap card → flip/reveal definitions+first example; grade buttons as a 4-column row: 再来/困难/良好/简单 (rating 1..4) → db_review_card({entityType, entityId, rating}) — CHECK srs.ts for its exact args signature; advance with progress indicator "3 / 24" top; haptic impact light per grade; completion screen with reviewed count + lapses count + Button back to "/" (router.dismissAll or navigate). Filter decks empty → EmptyState 全部复习完成.

QUALITY GATES: semantic colors only (usePalette for icon colors); all strings via useT with NEW keys added to BOTH zh and en vocabulary.ts; ≥44px targets; no raw SQL; no ScrollView+map for the words list; errors caught with inline message; when done run `bunx tsc --noEmit` in mobile_tanwords — must exit 0.

FINAL REPORT: bullet list of files created/edited, i18n keys added, any deviations from conventions + why, anything another area owns that you needed but couldn't edit.

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