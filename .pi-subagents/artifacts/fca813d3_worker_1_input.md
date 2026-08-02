# Task for worker

[Read from: /home/zteng/work/Tools/TanWords/context.md, /home/zteng/work/Tools/TanWords/plan.md]

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
You are building the Feeds (订阅) area of the TanWords mobile app: RSS articles, podcasts with audio playback, Hacker News, bookmarks, and the in-app article reader.

PROJECT: /home/zteng/work/Tools/TanWords/mobile_tanwords (Expo SDK 57, expo-router, NativeWind v4, strict TS, bun).
DESKTOP SPEC (read-only reference, NEVER edit anything under /home/zteng/work/Tools/TanWords/app or any path outside mobile_tanwords): ../app/src/components/Feeds/**, ../app/src/store/podcastPlayerStore.ts, ../app/core/src/hn.rs.

MANDATORY FIRST STEPS: read mobile_tanwords docs/UX-CONVENTIONS.md (binding), AGENTS.md, PLAN.md §6 feeds/reader/podcast rows, src/components/ui.tsx, app/(tabs)/index.tsx (exemplar), src/services/rss.ts, src/services/hn.ts, src/services/readability.ts, src/db/feeds.ts, src/db/searchHistory.ts, src/store/feedBookmarksStore.ts, src/store/feedsNavStore.ts, src/store/hnBrowseStore.ts. DO NOT edit those services/stores — extend via your own files.

YOUR OWNED FILES:
- CREATE: app/reader/[url].tsx, app/feed/hackernews.tsx, src/services/player.ts, src/components/feeds/**
- EDIT: app/(tabs)/feeds.tsx (placeholder now), src/i18n/zh/feeds.ts, src/i18n/en/feeds.ts, src/i18n/zh/hackernews.ts, src/i18n/en/hackernews.ts, src/i18n/zh/podcast.ts, src/i18n/en/podcast.ts (append keys only)

BUILD:
1. app/(tabs)/feeds.tsx — Screen + ScreenHeader t("feeds"…title key that exists) + SegmentedTabs [文章/播客/HN/收藏].
   - Articles segment: two-pane flattened for mobile: feed list is NOT separate — show entries (FlashList) newest-first grouped header = feed title; unread dot; unread count per feed in a compact filter chip row (横滑可选源); pull-to-refresh triggers services/rss.ts refresh/sync entry point IF one exists (check exports and reuse; if none, refresh = re-query only). Mark entry read on open. Tap → router.push({pathname:"/reader/[url]", params:{url: entryUrl, feed entry id if available}}).
   - Podcasts segment: entries with audio enclosures only; each row shows play button; playback goes through your new src/services/player.ts.
   - HN segment: SegmentedTabs二级 [Top/New/Best], FlashList via services/hn.ts (# points, comment count, domain), tap → router.push to /feed/hackernews?id=…其实是同文件的详情视图 or params; comments = threaded indented view (2-level indent, collapse by tap).
   - Bookmarks segment: feedBookmarksStore items, tap → reader route, long-press → remove bookmark.
   - Empty DB (no feeds) → EmptyState with hint that feeds sync from the desktop app (Turso) — no add-feed UI in this iteration.
2. app/reader/[url].tsx — full-screen reader: close button (header left), open-in-browser (expo-web-browser, header right), bookmark toggle. Body: use services/readability.ts to fetch+extract (check its exact exports/signature first), Skeleton while extracting, then render: title 22px, byline/site muted, then content. NO WebView; implement a compact html→RN renderer (over linkedom output): support h1-h3, p, li (•), blockquote (left border, muted bg), a (inline primary text, opens browser), figure/img (expo-image, capped height 240, resizeMode cover, rounded). Failure (paywall/network) → inline error + Button 在浏览器打开.
3. app/feed/hackernews.tsx — story detail + threaded comments from services/hn.ts (Algolia item API probably — check exports), children recursive with indent guides; long-comment collapse.
4. src/services/player.ts — expo-audio singleton player per expo SDK 57 API (check docs https://docs.expo.dev/versions/v57.0.0/sdk/audio/ .md if unsure): createAudioPlayer/useAudioPlayer patterns; expose: play(url, meta{title, feedTitle}), pause, resume, seekBy(sec), state store (zustand: status/position/duration/current meta) consumed by a MiniPlayer component in src/components/feeds/MiniPlayer.tsx (title, play/pause, 15s back/forward, progress bar) rendered at the bottom of the podcasts segment screen (above tab bar: position absolute bottom in feeds screen with proper insets). setAudioModeAsync({playsInSilentMode:true, shouldPlayInBackground? per docs}) for podcast playback when locked.

QUALITY GATES: conventions doc compliance; FlashList for all lists; haptics via ui primitives; all network errors degrade to inline retry blocks; bunx tsc --noEmit exits 0 in mobile_tanwords.

FINAL REPORT: files created/edited, i18n keys added, rss/reader/player API decisions you made, blockers.

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