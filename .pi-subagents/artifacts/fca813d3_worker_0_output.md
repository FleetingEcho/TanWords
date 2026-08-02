All verified. Final status:

## Done — Learn (学习) area complete

**Files created:** `app/(tabs)/learn.tsx` (rewritten), `app/word/[word].tsx`, `app/review/index.tsx`, `src/components/learn/index.tsx`
**Files edited:** `src/i18n/zh/vocabulary.ts`, `src/i18n/en/vocabulary.ts` (+15 keys each, append-only, parity confirmed: both now 154 lines)
**Shared files touched:** none

**What works:** words tab (search/debounce/FlashList/pull-refresh/skeletons/long-press star+delete), patterns tab (inline expand, star), review tab (due count + new-card cap + CTA), full FSRS review session route (`/review`), word detail route (`/word/:word`) with speak/star/delete/enrichment render. All semantic colors, all strings via `useT`, haptics everywhere, errors caught inline. `tsc --noEmit` ✓ zero errors from my files.

**Cross-agent note (not mine to fix):** global `tsc` currently exits 2 from `docs.tsx` + `player.ts` — those files belong to the other 2 agents still in flight; expected to self-resolve per their briefs.

**Deviations:** (1) `db_get_words` has no `limit` param — FlashList handles full list, same as desktop; (2) patterns segment labeled 例句 from existing dict, not 句式 — matches desktop spec's own naming; (3) no phonetic display — schema has no IPA field (desktop parity confirms it doesn't either).