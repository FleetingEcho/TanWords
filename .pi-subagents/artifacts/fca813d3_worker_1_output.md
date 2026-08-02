All clean in my scope. Final report:

## Feeds area — implementation complete

**What was built** (all from desktop parity spec, mobile-interaction adapted):

### Created
- `app/(tabs)/feeds.tsx` (edited placeholder) — 4-segment Screen (文章/播客/HN/我的收藏) via SegmentedTabs; MiniPlayer floats above the tab bar across all segments when a track is loaded.
- `app/reader/[url].tsx` — full-screen reader: close/bookmark/open-in-browser header; `fetchArticle` via services/readability; skeleton → styled RN body; episode play chip (drives global player); hero image fallback from entry cache; inline HN comments section for hnrss/HN entries; error → retry + 在浏览器打开.
- `app/feed/hackernews.tsx` — story detail (metadata via route params; services/hn has no single-item fetch) + threaded comments, bookmark toggle, discussion/browser links.
- `src/services/player.ts` — module-level `createAudioPlayer` singleton + zustand store (status/position/duration/track). SDK-57 verified: `setAudioModeAsync({playsInSilentMode, shouldPlayInBackground, interruptionMode:"doNotMix"})`, `setActiveForLockScreen(true, metadata, {showSeekBackward, showSeekForward})` (ditto `clearLockScreenControls()` — the docs' name differs, .d.ts is authoritative), `playbackStatusUpdate` listener, didJustFinish→stop, retry-on-toggle when errored.
- `src/components/feeds/ReaderBlocks.tsx` — sanitized-HTML→RN renderer (walk linkedom tree): h1–h3, p (selectable text — word lookup is core to this app), li (•/n., nested), blockquote (border+muted bg), pre/code, a (primary, opens browser), figure/img (expo-image cover 220px), hr, table→muted lines; `textToBlocks` fallback.
- `src/components/feeds/ArticlesSegment.tsx` — horizontal source chips (论文 unread badges, ScrollView so chips can't collapse) + date-grouped FlashList (今天/昨天/本周/更早, existing group keys); unread dot + muted titles when read; mark-read-on-open with unread-badge refresh; pull-to-refresh re-fetches every feed (fetchAndParseFeed→db_replace_feed_entries); first-visit auto-sync; load-more pagination.
- `src/components/feeds/PodcastsSegment.tsx` — enclosure-only entries, play/pause per-row via player store.
- `src/components/feeds/HnSegment.tsx` — 热门/最新/精选 segmented tabs + Algolia search, pagination with dedupe + end-reach arm-gating; state persists in hnBrowseStore (its designed purpose — unmount-survival).
- `src/components/feeds/BookmarksSegment.tsx` — bookmarks list, tap→reader, long-press→Alert destructively removes (`feeds.bookmarks.cancel` added for it).
- `src/components/feeds/EntryCard.tsx` / `HnStoryRow.tsx` / `HnComments.tsx` (flattened tree, indent guides, tap-author collapse + "n 条回复") / `MiniPlayer.tsx` (progress hairline, play/pause, ±15s seek, close) / `format.ts` (domain, duration, relative time via existing `feeds.recentlyRead.*` keys, date buckets).

### i18n keys added (zh + en, append-only, owned files)
`feeds.noFeeds.title`, `feeds.noFeeds.mobileHint` (Turso-sync guidance instead of add-feed CTA per spec), `feeds.unreadSummary`, `feeds.podcasts.empty`, `feeds.podcasts.emptyHint`, `feeds.bookmarks.hint`, `feeds.bookmarks.cancel`, `hn.search.submit`.

### API decisions
- **RSS refresh**: rss.ts ships parse-only — I built the fetch+persist loop *inside* ArticlesSegment using the two existing exports (no service edits allowed). A `syncAllFeeds()` belongs in rss.ts as a follow-up (noted as blocker-ish tech debt, harmless).
- **Reader navigation**: `/reader/[url]?entryId=&feedTitle=&hnItemId=`; entry DB row resolved lazily by `entryId` then by URL match from cached entries (covers bookmark opens which lack entryId).
- **HN story detail**: params-passed metadata + comments-only fetch; no new service function needed.
- **expo-audio method names taken from `build/*.d.ts`** (docs markdown used a different `removeFromLockScreen` name that doesn't exist).

### Blockers / shared-file notes
- None in my scope. `src/components/reading/WordLookupSheet.tsx` (Reading agent, in-flight) still has a type error — root `tsc` red until they finish.
- MiniPlayer is global to the Feeds tab only; rendering it on other tabs needs a root-layout mount (locked file, flagged for orchestrator).