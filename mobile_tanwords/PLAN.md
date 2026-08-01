# TanWords Mobile (Expo) — Implementation Plan

## Status (updated 2025-08-01)

**Done — foundation**: tab shell w/ large-title headers, light/dark theming (`src/lib/theme.ts` + NativeWind vars, tokens ported from desktop `theme-vars.css`), themable tab bar w/ haptics, shared UI primitives (`src/components/ui.tsx`), UX conventions (`docs/UX-CONVENTIONS.md`), Dashboard screen (M2-quality: review CTA, stats, recent words/read) with full loading/empty/pull-refresh states. Data layer: connection+schema bootstrap, words/patterns/srs/feeds/reading/dashboard/settings/providers/translations/knownWords/searchHistory. Services: rss, hn, readability, tts (expo-speech), secrets. Providers (base/anthropic/openai/custom) + providerStore. i18n zh+en copied. `ts-fsrs`, FlashList, expo-haptics installed.
**In flight (parallel)**: → **LANDED**: Learn area (words/patterns/review segments, `/word/[word]` detail, `/review` FSRS session), Feeds area (articles/podcasts/HN/bookmarks segments, `/reader/[url]` RN-native reader, `/feed/hackernews`, global MiniPlayer above tab bar via `src/services/player.ts`), Reading area (paste/URL import, streaming AI extraction, bottom-sheet accept flow, `/reading/[id]` sentence-level reader), Docs area (FTS search, markdown editor `/doc/[id]`), More/Settings (`/settings` appearance + instant theme switch, TTS speed, AI providers w/ SecureStore-only keys). Full repo `tsc --noEmit` clean; zh/en i18n key parity verified.
**Next up**: M5 sync (Turso profile connect in `connection.tsx` + "sync now" in settings), AI Chat (M4 remainder — routes exist as 即将推出 placeholders), Knowledge Map / Scene Lab / Music (M6), polish pass (M7: EAS profiles, error toasts).
**Carried constraints**: `EXPECTED_SCHEMA_VERSION` currently 27 — bump to match desktop when Turso sync lands (M5). Streaming AI relies on SDK 57 `expo/fetch` global — do NOT set `EXPO_PUBLIC_USE_RN_FETCH=1` (risk #5). Desktop-encrypted docs render locked notices only (argon2 port pending, risk #8).

Target: re-implement **all features of the TanWords desktop app** (Electron + React + Rust sidecar) as a native-feeling **Expo SDK 57** app, Chinese-first UI, sharing **one Turso database** with the desktop app.

Source app (reference implementation, read as the spec): `/home/zteng/work/Tools/TanWords`
This app: `/home/zteng/work/Tools/mobile_tanwords`

> Doc rule for this repo: always consult https://docs.expo.dev/versions/v57.0.0/ (append `.md` to any docs URL) before writing code. Do not assume pre-SDK-54 behavior.

---

## 1. What the desktop app actually is

Desktop TanWords = 3 layers:

| Layer | Tech | Where | Role |
|---|---|---|---|
| Renderer | React 19 + Zustand + Tailwind + BlockNote | `app/src/` | All UI, all AI call sites, prompts |
| Shell | Electron main + preload | `app/electron/` | Windows, tray, updater, sidecar lifecycle. **No data logic** |
| Backend | Rust sidecar over loopback HTTP + SSE | `app/core/` | libsql/SQLite + Turso replica, migrations, RSS/HN/reader fetchers, sherpa-onnx TTS, secrets in OS keychain, MCP server |

**Key insight**: Electron and Tauri are gone on mobile. The Rust sidecar's jobs split into: (a) things that become plain TypeScript repository modules (all `db_*` commands = SQL + a little logic), (b) things that become Expo modules (TTS, audio, secure storage, filesystem), (c) things that are dropped (MCP server, embedded browser panel, updater, native audio).

**AI calls already live in TypeScript.** `app/src/providers/{base,anthropic,openai,custom}.ts` call LLM HTTP APIs directly with streaming. They port almost verbatim (see §7.4).

### Desktop pages (the parity checklist)

From `app/src/components/Layout/Sidebar.tsx` + README:

1. **Dashboard** — resume article, recent words/patterns/docs, quick actions, review badge (`db_dashboard_stats`)
2. **Browser** — embedded browser panel → mobile: **drop**, use `expo-web-browser` to open externally
3. **Feeds** — RSS articles + podcasts side by side, unread counts, bookmarks, in-app reader, Hacker News (Top/New/Best + threaded comments)
4. **Reading** — paste article, AI extraction of words + sentence patterns, accept individually/bulk, sentence-by-sentence listening, translation
5. **Documents** — BlockNote editor, FTS5 search, tags, pinning, password protection, assets
6. **Vocabulary** — words master/detail (AI enrichment, examples, collocations, etymology, mnemonics, notes), **Patterns** tab (skeletons with slots, starred), FSRS review, Discover (themed batches, word families), Knowledge Map (2.5D map), Scene Lab
7. **AI Chat** — multi-session, tool use against app data
8. **Music** — local library scan by artist/album, persistent player
9. **Settings** — AI providers (keys encrypted, device-scoped), CEFR level, TTS model/speed, database location/Turso, backup/export/import

### Data layer facts that constrain the mobile port

- One SQLite file, WAL mode, `libsql` underneath — local profile *or* Turso embedded replica with background sync (`app/core/src/db/connection.rs`).
- Schema = **30 migrations** (`app/core/src/db/migrations/{v001_005..v027_030}.rs`), tracked in `schema_migrations`. Tables include: `words`, `word_definitions`, `patterns`, `pattern_examples`, `reading_articles`, `reading_article_comments`, `rss_feeds`, `rss_entries`, `feed_bookmarks`, `articles` (analysis), `srs_records`, `documents`, `document_assets`, `ai_providers`, `ai_chat_sessions`, `word_chats`, `knowledge_maps/nodes/edges`, `scenes*` (scene lab), `user_known_words`, `search_history`, `translations`, `settings`, plus FTS5 virtual tables for documents.
- FSRS lives in `srs_records(entity_type, entity_id, stability, difficulty, elapsed_days, scheduled_days, review_count, lapses, next_review_at, last_reviewed_at, state)`; `state`: 0=New(default), 1=Learning, 2=Review, 3=Relearning. `next_review_at` may be RFC3339 **or** SQLite `datetime('now')` format — readers must parse both (mirror of `sql_to_dt` in `app/core/src/db/srs.rs`).
- AI provider keys: AES-256-GCM in DB under a device key held in the OS keychain; PK is `(device_id, id)` → **provider credentials never sync across devices**. Mobile does its own provider setup; this is by design.
- Turso auth token: stored in OS keychain on desktop. Mobile: user enters it once → `expo-secure-store`.
- UI is Chinese-first (`app/src/i18n/zh/*`, ~2.7k lines across 22 modules) with English fallback; custom `useT()` hook reads `uiLanguage` from the settings store.

---

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Share one Turso DB with desktop** via `expo-sqlite` libSQL embedded replica (`libSQLOptions: { url, authToken }` + `db.syncLibSQL()`). Local-only mode = plain `expo-sqlite`. | Chosen. Vocabulary + FSRS progress roam across devices. |
| D2 | **Desktop owns the schema. Mobile never migrates a shared DB.** Mobile ships a frozen `schema.sql` snapshot (generated from a fresh desktop DB) used **only** to create brand-new *local-only* databases. Against a Turso replica the schema arrives via sync. | Two writers of the same 30-migration chain = corruption risk. libSQL replica pulls desktop-applied migrations automatically. |
| D3 | **Chinese-first UI**; port `app/src/i18n/{zh,en}` verbatim + port the tiny `useT` hook. | Chosen. |
| D4 | Full feature parity, phased (§9). Browser panel, MCP server, desktop updater, tray are **explicitly dropped**; sherpa-onnx TTS is replaced, not ported. | Mobile platform reality. |
| D5 | **Development build, not Expo Go.** libSQL (`useLibSQL: true` config plugin) requires prebuild. Expo Go = local-only demo mode at best. | expo-sqlite docs, SDK 57. |
| D6 | Navigation: **expo-router** (file-based), bottom **tabs** for the 6 primary areas + native stack pushes for detail screens. Sidebar → tabs is the core "mobile way" change. | Standard Expo v57 layout. |
| D7 | Styling: **NativeWind** (Tailwind for RN) so desktop Tailwind intent ports class-by-class where possible; re-skin to mobile (full-width lists, bottom sheets instead of modals, `SafeAreaView`). | Fastest faithful port. |
| D8 | Secrets in `expo-secure-store` (Turso token, LLM API keys). Mirror desktop's per-device provider scoping: mobile generates its own `device_id` (persisted), so rows never clash with desktop's. | Matches `(device_id, id)` PK design. |

---

## 3. Target architecture

```
mobile_tanwords/
  app/                        # expo-router routes
    (tabs)/
      index.tsx               # Dashboard
      reading.tsx             # Reading (paste/extract)
      feeds.tsx               # Feeds + reader + HN
      learn.tsx               # Vocabulary / Patterns / Review / Discover / Map / Scenes (top tabs)
      docs.tsx                # Documents
      more.tsx                # Settings, AI Chat, Music, Data, About
    reader/[url].tsx          # full-screen in-app article reader
    word/[word].tsx           # word detail (push instead of modal)
    review/index.tsx          # FSRS review session
    chat/[sessionId].tsx      # AI chat
    feed/hackernews.tsx       # HN lists
    _layout.tsx               # root: SQLiteProvider + theme + players
  src/
    db/                       # THE port of app/core/src/db/*.rs
      connection.ts           # profile open/switch/fallback (lib.rs open_startup_db)
      schema.sql              # frozen desktop schema for new local DBs (D2)
      migrations-guard.ts     # refuse to migrate; verify schema_migrations >= 30
      words.ts patterns.ts srs.ts feeds.ts reading.ts
      documents.ts chat.ts dashboard.ts settings.ts import.ts
    providers/                # ported ~verbatim from app/src/providers/*
      base.ts anthropic.ts openai.ts custom.ts providerStore.ts
    ai/                       # prompt builders + parsers (patternFromSentence.ts, jsonrepair)
    services/
      tts.ts                  # expo-speech wrapper, sentence queue
      player.ts               # expo-audio podcasts/article playback
      rss.ts                  # fetch + fast-xml-parser (port of core/src/rss)
      hn.ts                   # HN Algolia + official API (core/src/hn.rs)
      readability.ts          # linkedom + @mozilla/readability (core/src/reader.rs)
      secrets.ts              # expo-secure-store
      sync.ts                 # db.syncLibSQL() orchestration, connectivity gating
    stores/                   # zustand stores (port of app/src/store/*)
    i18n/                     # copy of app/src/i18n + useT.ts
    components/               # mobile UI
  app.json                    # plugins: expo-sqlite(useLibSQL, FTS), expo-router, secure-store...
```

Everything the renderer used to call as `invoke("db_get_words", …)` becomes an async TS function with the **same name and same SQL** — port file-by-file from `app/core/src/db/*.rs`. Keep `useDB.ts/@/hooks` shaped similarly so screen logic ports mechanically.

---

## 4. Data layer detail

### 4.1 Connection profiles (port of `core/src/lib.rs::open_startup_db` + `appconfig.rs`)

- Profiles: `Local { path }` | `Turso { url }` (+ token from SecureStore). Persisted in `expo-sqlite/kv-store` (AsyncStorage-compatible) or a tiny JSON file.
- `openDb()`: try saved profile → on failure fall back to local default DB and surface a one-time warning (same UX as desktop's `db_fallback_warning`). Failed **local** profile is forgotten; failed **Turso** profile is kept (transient network) — same self-healing rules as desktop.
- Turso open: `openDatabaseAsync('tanwords.db', { libSQLOptions: { url, authToken, remoteOnly: false } })`, then `await db.syncLibSQL()` on app foreground + after writes batch (debounced) + explicit "Sync now" in Settings (port `db_sync_now`).
- Enable change listener (`enableChangeListener: true`) to drive reactive UI refresh instead of SSE events.
- PRAGMAs on open: `journal_mode = WAL`, `foreign_keys = ON`. FTS5 is enabled by default in expo-sqlite (`enableFTS: true`).

### 4.2 Schema strategy (D2)

- Ship `src/db/schema.sql`: dump of a fresh desktop DB (`sqlite3 tanwords.db .schema`), version-stamped. Used **only** when creating a new local-only DB (or when DB has 0 migrations applied).
- On every open: `SELECT max(version) FROM schema_migrations` — if `< 30`, don't guess; require sync/pull or warn (for Turso) / apply `schema.sql` (for empty local). Never run partial migrations on mobile.
- Bookmark this: desktop may add migrations later → bump the expected version + regenerate `schema.sql`. Add a single constant `EXPECTED_SCHEMA_VERSION = 30`.

### 4.3 FSRS port (`core/src/db/srs.rs` → `src/db/srs.ts`)

- Package: **`ts-fsrs`**. Map: `rs-fsrs Card ↔ srs_records row` exactly as the Rust code does (`stability, difficulty, elapsed_days, scheduled_days, review_count→reps, lapses, next_review_at→due, last_reviewed_at, state 0..3`).
- Port rating buttons: Again/Hard/Good/Easy = 1..4.
- **Must port verbatim**: `db_get_review_count` backlog logic (due + `min(new, 20)` cap — Dashboard badge parity), `db_get_due_cards` (backlog first, then new introductions), `sql_to_dt` dual-format date parsing, `DEFAULT_NEW_LIMIT = 20`.
- Parity test: fixed sequence of ratings on a fixed card, assert identical `stability/difficulty/next_review_at` vs desktop at same clock (freeze `now`).

### 4.4 AI provider store (`core/src/db/ai_providers.rs` → `src/db/providers.ts` + `src/services/secrets.ts`)

- Same table (`ai_providers`). Mobile generates + persists a random `device_id` (SecureStore) — keys are per-device forever, so no cross-device leakage, same as desktop.
- Desktop encrypts keys with a keychain-held master key. Mobile simplification: store plaintext keys **only** in SecureStore; store `api_key_enc = '__secure_store__'` sentinel (never plaintext in DB, never synced). List/upsert/delete logic ports 1:1 otherwise.

---

## 5. Mobile navigation & layout mapping

Sidebar items → tab bar (6 tabs, icons ≈ desktop):

| Desktop (sidebar) | Mobile route | Mobile UX change |
|---|---|---|
| Dashboard | `(tabs)/index` | Same info, stacked cards instead of grid |
| Feeds | `(tabs)/feeds` | Lists + top segmented filter (Articles / Podcasts / HN / Bookmarks); reader pushes as full-screen route |
| Reading | `(tabs)/reading` | Paste/URL input at top; analysis results as bottom-sheet accept flow |
| Vocabulary | `(tabs)/learn` | Top tab bar: Words · Patterns · Review · Discover · Map · Scenes |
| Documents | `(tabs)/docs` | Document list → push to editor |
| Settings/Chat/Music | `(tabs)/more` | "More" hub list → sub-stacks |

Other mappings:
- `WordDetailModal` → pushed route `word/[word]` (bottom-sheet alternative OK, but route deep-links better).
- Persistent podcast/music player bar → absolute-positioned mini-player above the tab bar (same idea as desktop).
- Popovers/hover (Reader toolbar) → long-press & action sheets. Command bar → global search screen.
- Desktop "Resume" deep state (feedsNavStore) → keep zustand stores with same names; add persistence for nav state via `expo-sqlite/kv-store`.

---

## 6. Feature port matrix (the checklist)

Legend: 🟢 direct port · 🟡 port with platform substitution · 🔴 re-think for mobile

| Feature | Desktop source | Mobile plan | Effort |
|---|---|---|---|
| Dashboard | `components/Dashboard`, `db/dashboard.rs` | 🟢 port SQL + cards | M |
| Vocabulary list+detail | `components/Vocabulary`, `db/words_*` | 🟢 FlatList + detail route; speak button → expo-speech | M |
| Word enrichment prompts | `providers/base.ts` | 🟢 verbatim | S |
| Patterns library | `features/patterns`, `db/patterns.rs` | 🟢 list + detail + star | M |
| FSRS review | `db/srs.rs`, quiz UI | 🟡 ts-fsrs + swipe/grade cards | M |
| Reading (paste/analyze) | `components/Reader`, `hooks/useAnalyzeArticle.ts`, `db/reading.rs` | 🟢 same flow, sheet-based accept | L |
| Sentence split + TTS playback | `lib/sentences.ts`, `store/ttsPlayerStore.ts`, sherpa-onnx | 🟡 splitter ports verbatim; TTS → expo-speech queue with `onDone` chaining; highlight current sentence | M |
| Feeds (RSS+podcast) | `core/src/rss/*`, `components/Feeds` | 🟡 fetch + fast-xml-parser; entries cache tables port 1:1 | M |
| Podcast player | `store/podcastPlayerStore.ts` | 🟡 expo-audio + `setAudioModeAsync({ playsInSilentMode })`; lock-screen controls need background audio entitlement | M |
| Hacker News | `core/src/hn.rs` | 🟢 plain fetch | S |
| In-app article reader | `core/src/reader.rs` (fetch+readability) | 🟡 `@mozilla/readability` + `linkedom` (no DOM in RN); render extracted content as styled RN text blocks | M |
| AI Chat + tools | `components/AiChat`, `db/chat.rs`, provider `chatWithTools` | 🟢🟡 provider code ports; tools = thin wrappers over `src/db/*` | L |
| Documents | `components/Documents` (BlockNote, FTS5, assets, lock) | 🔴 BlockNote is web-only. v1: markdown editor (`TextInput` + markdown renderer); FTS5 search ports as-is (expo-sqlite FTS on); password-protect: port `document_privacy` hashing to JS (SHA-256 via expo-crypto — verify desktop algo first); assets via expo-file-system | L |
| Discover (themed batches/word family) | `components` + provider prompts | 🟢 prompts port, list UI | M |
| Knowledge Map | knowledge_* tables, canvas UI | 🔴 2.5D desktop viz → `react-native-svg` (or Skia) pan/zoom node graph, same tables | L |
| Scene Lab | `features/scene-lab`, `db/scene_lab.rs` | 🟡 SQL ports; UI re-layout as step-by-step mobile flow | L |
| Music | `music.rs` (folder scan), native_audio | 🔴 scan → `expo-media-library` (device library, permission-gated); player → expo-audio. No folder scanning on iOS | L |
| Settings | `components/Settings`, `db/settings.rs` | 🟢 same `settings` table; screens per section | M |
| Backup/export/import | `db_import_*`, `db_export_backup` | 🟡 export DB file via Sharing API; import analyze/apply SQL ports 1:1 | M |
| Turso sync UX | `db_connect_turso`, `db_disconnect_remote`, `db_get_remembered_turso` | 🟡 same flows against expo-sqlite libSQL | M |
| Embedded browser | Electron-only | ❌ dropped (open in system browser) | — |
| MCP server | `core/src/mcp` | ❌ dropped | — |
| On-device Kokoro/Piper TTS | `core/src/tts` | ❌ replaced by expo-speech voices | — |
| Updater/tray | Electron | ❌ dropped (EAS Update later if wanted) | — |

---

## 7. Porting guide — the parts that are nearly free

### 7.1 i18n (copy-paste)
Copy `app/src/i18n/{zh,en,translations.ts,types.ts}` as-is. Port `useT.ts` (`zustand` + same store shape).

### 7.2 Zustand stores (near copy-paste)
`app/src/store/*.ts` (24 stores) are platform-free except player/browser ones. Port all data stores verbatim (`feedBookmarksStore`, `feedsNavStore`, `wordModalStore`→route params, `settingsStore`, `vocabEnrichStore`, `readingPageStore`, `learnChatStore`…). Replace `invoke()` import with `src/db/*` calls — ideally keep a thin `invoke.ts` shim with identical signatures so stores don't change.

### 7.3 Sentence utilities & parsers (copy-paste)
`lib/sentences.ts`, `lib/patternFromSentence.ts`, `thinkTagFilter.ts`, `jsonrepair` usage — all pure TS. Keep their vitest tests.

### 7.4 AI providers (small edits)
Desktop: `providers/base.ts` (all prompt builders), `anthropic.ts`, `openai.ts`, `custom.ts`.
- Replace `netFetch` with global `fetch` — SDK 57 installs `expo/fetch` (WinterCG-compliant, streaming `response.body.getReader()`) as the global on iOS/Android, so the existing SSE parse loops work unchanged.
- Replace `useSettingsStore.getState()` reads of plaintext key with SecureStore-backed provider resolution (`D8`).
- Keep `thinkTagFilter`, model preferences, provider selection logic.

### 7.5 SQL commands → TS modules (mechanical)
Port each `#[command] pub async fn db_*` in `app/core/src/db/*.rs` to an exported async function in `src/db/*` using the same SQL and row mappings (`rows.rs` ↔ TS interfaces already written in `hooks/useDB.types.ts` — copy those types).

### 7.6 Fetchers (small ports)
- RSS (`core/src/rss/*`): JS `fetch` + `fast-xml-parser`; keep entry normalization rules (dedupe by URL, audio enclosure detection ⇒ `is_podcast`).
- Reader (`core/src/reader.rs` + `fetch_article`): `fetch` → `linkedom.parseHTML` → `new Readability(doc).parse()` → strip to text blocks.
- HN (`core/src/hn.rs`): same endpoints.

---

## 8. Packages to install

```bash
bunx expo install expo-router expo-sqlite expo-secure-store expo-speech \
  expo-audio expo-file-system expo-media-library expo-web-browser \
  expo-crypto expo-sharing expo-clipboard expo-linking react-native-svg \
  react-native-safe-area-context react-native-screens expo-constants expo-network
bun add zustand ts-fsrs fast-xml-parser @mozilla/readability linkedom jsonrepair
bun add nativewind tailwindcss react-native-reanimated
```

`app.json` plugins: `expo-router`, `["expo-sqlite", { "useLibSQL": true, "enableFTS": true }]`, `expo-secure-store`, and background-audio mode for podcast playback. Then `bunx expo prebuild` and run a **development build** (libSQL is not in Expo Go — D5).

---

## 9. Phases

- **M0 — Skeleton** (½–1 day): prebuild, NativeWind, tabs shell, i18n copy, settingsStore port, dark mode.
- **M1 — Data core**: `schema.sql`, connection profiles + fallback, `EXPECTED_SCHEMA_VERSION` guard, port `settings/words/patterns/srs` modules, seed screens: Vocabulary list + word detail + speak. *Gate*: open desktop-created Turso replica read-only and render real data.
- **M2 — Learning loop**: Reading paste/analyze/accept flow, Patterns tab, FSRS review session + Dashboard badge parity, enrichment streaming. *Gate*: review the same card on mobile and desktop without corrupting each other's schedule.
- **M3 — Feeds**: RSS sync service, feed/entry lists, reader route (readability), bookmarks store, podcast mini-player (expo-audio), HN.
- **M4 — Docs & Chat**: markdown documents + FTS5 search + tags/pin; AI chat sessions + tool use; Discover.
- **M5 — Sync & Settings**: Turso connect/disconnect + token in SecureStore + "sync now", provider management, backup/export/import, TTS speed settings.
- **M6 — Extended**: Knowledge Map (svg graph), Scene Lab, Music (media-library), document lock/assets, comments on articles.
- **M7 — Polish**: empty states, error toasts (port `sonner`→mobile toast), performance pass (FlashList for long lists), EAS build profiles.

---

## 10. Risks & verification

1. **Schema drift** — biggest risk. Mitigate with `EXPECTED_SCHEMA_VERSION` guard + read-only posture on shared DBs + regenerate `schema.sql` when desktop adds migrations.
2. **FSRS divergence** — parity test vectors against desktop `rs-fsrs` (frozen clock, same ratings → same next_review_at).
3. **Concurrent review on two devices** — last-writer-wins per card within a sync window; acceptable for single-user use, document it.
4. **`next_review_at` dual date format** — port `sql_to_dt` exactly.
5. **Streaming fetch** — requires SDK 57's `expo/fetch` global (do **not** set `EXPO_PUBLIC_USE_RN_FETCH=1`); add a startup smoke check that `response.body.getReader` exists.
6. **Readability in RN** — no DOM; validate `linkedom + @mozilla/readability` on 10 real articles early (M3 spike) before building the reader UI.
7. **Background audio/track controls** — verify `expo-audio` lock-screen controls on a real device in M3; fallback plan: in-app-only playback controls.
8. **Document privacy hash compat** — read `core/src/document_privacy/*` first; if it's Argon2, use `react-native-quick-crypto`/pure-JS argon2; don't invent a new scheme or desktop-locked docs won't unlock on mobile.
