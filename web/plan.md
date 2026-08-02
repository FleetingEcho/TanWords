# TanWords Web — Plan

A flexible web version of TanWords: one Rust (axum) backend serving a Vite + React 19 + TSX SPA,
usable from desktop and mobile browsers. Self-hosted by design (run it on your machine, NAS, or VPS
and reach it from any device).

## 0. Key findings that shape this plan

Findings from exploring the existing codebase (verified against source, not assumptions):

1. **A Rust axum backend already exists.** `app/core/src/server.rs` serves
   `POST /invoke/{command}` (bearer-token RPC over HTTP), `GET /events` (SSE), and `GET /asset`.
   The Electron renderer already talks to it over plain HTTP (`app/src/ipc/backend.ts`).
   → The web backend is *mostly an adaptation of the existing core*, not a rewrite.
2. **167 commands exist** (`app/core/scripts/commands.txt`): all of `db::*` (words, patterns,
   documents, chat sessions, reading articles, SRS/FSRS, settings, ai_providers...),
   `document_privacy::*`, `reader::fetch_article`, `rss::*`, `hn::*`, `mcp::*`, `localdocs::*`,
   plus `tts::*`, `native_audio::*`, `music::*` (which the web server never builds — they back
   Music/TTS/local-file audio only). **Podcast episode audio needs no server code at all**: it
   streams from each episode's public enclosure URL straight into a browser `<audio>` element.
3. **Only two main-process command families exist** outside the sidecar: `browser_panel::*`
   and `tray_*` — both are meaningless on the web and simply disappear.
4. **AI provider calls live in the renderer** (`app/src/providers/*.ts`): Anthropic/OpenAI/etc.
   are called client-side. On the web this hits browser CORS for some providers — the web server
   needs a provider proxy route (see §3.4). Verify per provider during implementation.
5. **Heavy native deps can be cut.** TTS (`sherpa-onnx` = static C++/ONNX build), `rodio`,
   `symphonia` exist only for TTS/music — exactly what we drop. These must move behind Cargo
   feature flags or the web server build becomes very heavy.
6. **`secrets.rs` depends on the OS keychain.** On a headless server (no Secret Service /
   keychain) `device_key()` returns `None` and AI provider keys **silently can't be stored**.
   Web needs a file/env-backed master key (§3.3). This is a **critical** fix, easy to miss.
7. **Frontend is already organized for reuse**: page-level component trees
   (`components/Dashboard|AiChat|Vocabulary|Settings|Documents|Reader|Feeds`), zustand stores,
   i18n, and a small IPC boundary (`app/src/ipc/*`, `providers/*`) — only that boundary changes.

## 1. Goals / Non-goals

### Goals (v1)
- 6 pages, responsive (desktop sidebar ↔ mobile bottom-nav):
  **Dashboard, AI Chat, Words & Sentences (FSRS review included), Reading, Docs, Settings.**
  Reading additionally hosts the **Feeds & Podcasts** tabs; episode playback is available from
  every page via a persistent player bar.
- One Rust axum binary in `web/server/` that:
  - exposes the backend API with token auth (login flow, not just a random per-process token),
  - serves the built frontend (single binary deployment),
  - keeps SSE event stream for realtime UI updates.
- Vite + React 19 + TSX SPA in `web/frontend/`, reusing as much of `app/src` as possible.
- Same data model: local SQLite by default, optional Turso connection (this also doubles as the
  bridge for sharing one vocabulary across desktop and web).
- AI chat & enrichment work server-reachable (provider keys stored on the server, encrypted).
- RSS stays: article feeds + podcast subscriptions (subscribe/sync/list via existing `rss::*`
  commands), with in-browser episode playback — public internet audio rendered by
  `HTMLAudioElement`, no Rust involvement, no CORS issues for media playback.

### Non-goals (v1)
- Music page (local-file library), TTS (Kokoro/Piper voices, `sherpa-onnx`), and all local/system
  audio output: `music::*`, `native_audio::*`, `tts::*` are feature-gated out of the server build.
  "Speak" buttons are removed from the ported UI.
- HackerNews page (commands remain available server-side; easy post-v1 add).
- Episode/media proxying: enclosures stream from their origin URLs as-is (mixed-content caveat in
  Risks; a passthrough media proxy is a post-v1 option if it bites).
- Browser panel, system tray, auto-updater, `localdocs` (OS-folder browsing), Electron dialogs.
- Multi-user accounts. The data model is single-user; auth is a shared password / owner token.

## 2. Repository layout

```
web/
  plan.md                ← this file
  server/                Rust crate (bin): the web backend
    Cargo.toml           depends on tanwords_lib via path, no heavy features
    src/
      main.rs            config/env, logging, startup
      server.rs          axum router composition: auth, /invoke, /events,
                           /api/auth, /api/ai-proxy, /api/assets, static SPA, SPA fallback
      auth.rs            password → session token (opaque, in-memory + optional persisted)
      config.rs          TANWORDS_* env / flags
  frontend/              Vite + React 19 + TS functional components + Tailwind 4
    index.html
    package.json         bun workspace member? standalone is fine; decide in §7.1
    vite.config.ts       dev proxy → http://127.0.0.1:8740
    src/
      api/client.ts      ◄ replaces app/src/ipc/backend.ts (+host.ts) — only boundary change
      api/types.ts       copied from app data/types as needed
      pages/{Dashboard,AiChat,Vocabulary,Reading,Docs,Settings}/
      components/…       ported from app/src/components (see reuse map §6)
      store/             zustand stores, mostly copied verbatim
      i18n/              copied
      router or navStore mirror of the desktop's page switching
      responsive layout (Sidebar desktop / BottomTabs mobile)
```

`app/core` is consumed **as a library** (`tanwords_lib = { path = "../../app/core" }`). The core
crate needs small additive changes (feature flags + a master-key override) — see §3.

## 3. Backend design

### 3.1 Transport strategy — keep `/invoke`, design intent "REST-shaped resource commands"

The pragmatic choice, and a recommendation (open to change):

- **Phase A:** keep the existing `POST /invoke/{command}` + SSE protocol. This lets the frontend
  reuse ~100 existing call sites verbatim; behavior parity with desktop comes free. The dispatch
  table is already generated by `app/core/build.rs`; the web server just mounts the same handler.
- **Phase B (after v1):** add idiomatic REST routes (`GET /api/words?cursor=…`,
  `POST /api/documents/:id`, ...) as a thin façade over the same functions, for external tooling.
  Frontend migrates only if/when it wants to.

Rationale: rewriting all 167 commands into hand-tuned REST routes up front is the riskiest way to
spend week 1; command names are already resource-shaped (`db_list_patterns`, `db_review_card`).

### 3.2 Core crate changes (in `app/core`, kept desktop-compatible)

- **Cargo features** in `app/core/Cargo.toml`:
  - `default = ["desktop"]`; `desktop = ["tts", "audio"]`; `web = []` (thin).
  - `#cfg`-gate modules `tts`, `native_audio`, `music` and their deps (`sherpa-onnx`, `rodio`,
    `symphonia` → `optional = true`).
  - `build.rs`: `generate_dispatch_table()` skips feature-gated command families when building
    with `--no-default-features` (remove them from an effective `commands.txt` list / tolerate
    `SKIP_MODULES`-style entries). Web uses its own `commands.txt` subset copied at build time:
    all `db::*`, `document_privacy::*`, `reader::*`, `rss::*`, `hn::*`, `mcp::*`, `secrets::*`
    minus `localdocs::*` (OS-folder access; out of web scope).
- **`AppState` / `run()` split:** `lib.rs::run()` currently does startup-and-serve for the
  sidecar. Refactor into `build_state() -> (Registry, AppHandle)` + callers; web/server composes
  its own axum router around it (its own auth; also serves SPA static; no stdout handshake).
- **`secrets.rs` master-key override:** when env `TANWORDS_MASTER_KEY` (hex/base64, 32B) is set,
  `device_key()` returns it instead of touching the OS keychain. Same for Turso token: allow
  env/file-backed storage when keychain is unavailable (server mode is opt-in explicit).
  - Document prominently: set via systemd Environment / Docker secret, **never** baked into image.

### 3.3 Web server specifics (`web/server`)

- **Config (env-first):**
  `TANWORDS_HOST` (default `127.0.0.1`; use `0.0.0.0` for LAN, behind HTTPS off-load),
  `TANWORDS_PORT` (default `8740`), `TANWORDS_PASSWORD` (required — refuses to boot without it),
  `TANWORDS_DATA_DIR`, `TANWORDS_MASTER_KEY`, `TANWORDS_WEB_DIST` (dist path, default `./dist`),
  `TANWORDS_TURSO_*` passthrough if desired.
- **Auth:**
  - `POST /api/auth/login {password}` → constant-time compare against `TANWORDS_PASSWORD`
    (hashed at startup into memory via argon2id to blunt timing), returns an opaque
    32-byte session token; sessions held in memory (restart = re-login is acceptable) with
    30-day sliding expiry. `Authorization: Bearer <token>` guards everything except
    `/api/auth/*` and static assets landing page shell.
  - SSE `/events?token=` stays (EventSource can't set headers) — same validation.
  - Rate-limit login attempts (simple per-IP bucket), log failures.
- **Routes:**
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
  - `POST /invoke/:cmd` — dispatch table (auth-gated)
  - `GET  /events` — SSE (auth-gated)
  - `GET  /asset?path=` — **disabled on web** (no arbitrary server files from a browser);
    document assets go through §3.4 `/api/assets/:id` (DB blobs).
  - `POST /api/import` (multipart) → `db_import_analyze/apply` — replaces Electron file dialogs.
  - `GET  /api/export` → streams `db_export_backup` result — replaces save dialog.
  - `GET  /api/ai-proxy/:provider/*path` — §3.4.
  - SPA: `ServeDir(dist)` + fallback to `index.html`; long-cache hashed assets, `index.html` no-cache.
  - No `/api/media-proxy` in v1: `<audio>` plays episode enclosure URLs directly from their origins.
- **CORS:** not needed in production (same origin). Dev only: Vite proxy (`server.proxy` in
  frontend `vite.config.ts`) so even dev CORS is a non-issue.

### 3.4 AI provider proxy (decision needed at implementation time)

Verify empirically which configured provider endpoints accept browser `fetch` (OpenAI does;
Anthropic historically blocks browser calls without `anthropic-dangerous-direct-browser-access`,
and even that leaks keys to the device). **Plan: proxy always** — `GET/POST /api/ai-proxy/...`
forwards to the provider with the decrypted key injected server-side. Benefits: no keys on
phones, no CORS surprises, one code path. Streaming: pass SSE through untouched (axum
`Body::stream`), keep the renderer's existing stream parser.

### 3.5 Events

Keep the existing broadcast channel → SSE. Frontend `events.ts` reuse.

## 4. Frontend design

### 4.1 API boundary — the only files rewritten

| `app/src/...` | `web/frontend/src/...` | Change |
|---|---|---|
| `ipc/backend.ts` | `api/client.ts` | same exported `invoke(command, args)` + `backendToken`/`backendOrigin`, but token comes from login; no preload handshake; base URL = same origin (`""`) |
| `ipc/host.ts` | — | deleted (replaced by thin browser equivalents where used: `navigator.clipboard`, `window.open`, `<input type=file>`, `URL.createObjectURL` for exports) |
| `ipc/updater.ts`, `shell.ts`, `dialog.ts`, electron-only bits; `lib/ttsBackend.ts`, `lib/localAudioSrc.ts`, `lib/recommendedTtsModels.ts`, `lib/audioChannel.ts` | — | dropped (no TTS/music on web) |
| `ipc/events.ts` | `api/events.ts` | path + token only; SSE reuse |
| `providers/*.ts` | `providers/*.ts` | provider base URLs switched to `/api/ai-proxy/...`; streaming code unchanged |
| `lib/secrets.ts` | — | keys move server-side; UI stores nothing sensitive |

Everything above is the **seam**. Stores, pages, lib utilities, i18n all ride on top unchanged.

### 4.2 Page scope & reuse map

| Web page | Source components (`app/src/components/...`) | Notes / desktop-only bits to strip |
|---|---|---|
| Dashboard | `Dashboard/*` | `db_dashboard_stats`, recent words/patterns/docs; drop podcast/music resume widgets |
| AI Chat | `AiChat/*`, `store/learnChatStore.ts` | chat sessions CRUD + tool cards; provider calls via proxy; drop voice shortcuts |
| Words & Sentences | `Vocabulary/*`, `WordDetail*`, `features/patterns/*`, `store/wordModalStore` etc. | FSRS review (`db_get_due_cards/db_review_card`); TTS speak buttons removed entirely (per updated scope) |
| Reading | `Reader/*`, reading stores | saved articles (`db_*reading_article*`), fetch-by-URL (`reader::fetch_article`), extraction/enrichment flows reused |
| Feeds & Podcasts (tabs inside Reading) | `Feeds/*` (`FeedsPage`, `FeedTabs`, `EntryGrid/EntryCard`, `AddFeedDialog`, `feedSeeding`, `defaultFeeds`), `store/feedsNavStore`, `store/feedBookmarksStore` | subscribe/sync/list/bookmark via `rss::*`; podcasts auto-grouped by existing `is_podcast` flag; `HackerNewsSection.tsx` left out |
| Audio player (persistent, all pages) | port `ui/PodcastPlayerBar.tsx` + its speed-selector / now-playing pieces, `store/podcastPlayerStore` | one shared `<audio>` element; play/pause/seek/speed/progress bookend onto the element API (`ended`/`timeupdate` drive the store); plays `RssEntry.audio_url` |
| Docs | `Documents/*`, BlockNote stack | DB documents only (no `localdocs`); assets via `db_*document_asset*` blobs served at `/api/assets/:id`; keep `document_privacy` lock/unlock |
| Settings | `Settings/{ProviderSection,CustomProviderPanel,LearningSection,GeneralSection,...}` | keep: AI providers, learning, appearance, data (Turso connect + web import/export). Drop: TTS section, MCP section (server-only config), private-doc-section stays |

Shared: `shared/`, `ui/` primitives, `AppBackground`, `sonner` toasts, `features/scene-lab`
(excluded from nav in v1; keep commands server-side).

### 4.3 Responsive layout system

- **Layout shell:** `<AppShell>` chooses chrome by media query (`useMediaQuery`); no page
  rewrites — pages fill the content slot.
  - ≥1024px: existing `Layout/Sidebar` look (left rail, full labels).
  - <1024px: top bar (title + overflow) + **bottom tab bar** (6 tabs, icons + zh labels),
    safe-area insets (`env(safe-area-inset-bottom)`), overscroll containment.
- **Per-page patterns:**
  - Two-pane pages (Vocabulary list/detail, Docs list/editor, Chat sessions/conversation):
    `@media <lg` collapses to single pane with in-page navigation (list → detail pushes a
    sub-view, bottom bar hides on detail view for space).
  - Composer inputs fixed above the keyboard: `visualViewport` handling in Chat/Reading notes.
  - Tap targets ≥44px, text ≥16px in inputs (prevents iOS zoom), `-webkit-tap-highlight` off.
  - Audio player on mobile: mini-bar docks directly above the bottom tab bar (inside the safe-area
    inset); tapping it opens a full-screen sheet with artwork + progress + speed controls. On
    desktop it mirrors the desktop app's `PodcastPlayerBar` above the content edge. The bar exits
    the layout flow when nothing is loaded, so it never wastes vertical space.
- **PWA-lite:** manifest + theme-color + apple-touch-icon so "Add to Home Screen" looks right on
  phones. Full offline service-worker: out of scope v1 (app is fundamentally server-backed).

### 4.4 State, data, i18n

- zustand stores copy over; purge desktop-only ones (`ttsPlayerStore`, `browserPanelStore`,
  `updaterStore`, `toolsBallStore` if unused). **`podcastPlayerStore` is kept and ported**: swap
  its audio backend for one shared `HTMLAudioElement` — no Rust audio commands are called at all.
- `settingsStore`/`readingPageStore` and friends unchanged — they already call `invoke`.
- i18n: copy `i18n/` verbatim (Chinese-first UI retained).

## 5. Data & compatibility

- Same SQLite schema and migrations (`db/migrations`) — a web server and the desktop app can both
  point at the same Turso database (embedded replica on desktop, remote on web, or vice versa).
- Document assets: web stores blobs via existing `db_create_document_asset`;
  `/api/assets/:id` serves with correct content-type + immutable cache headers.
- FSRS / review, patterns, enrichment formats — untouched, reusing `db::*` as-is.

## 6. Implementation phases (proposed order)

- [x] **P0 — Scaffold.** `web/server` Cargo crate wired to `tanwords_lib` (path dep,
      `no-default-features` + `web`); feature-gated heavy modules in `app/core`
      (`desktop = [“tts”, “audio”]`, `web = []`); `web/frontend` Vite app booted
      with Tailwind, `api/client.ts`, dev proxy; auth-gated Login screen.
      Smoke verified: login → invoke(“db_dashboard_stats”) → 200. (Done incl. §3 env config, argon2 login, sessions, rate limit.)
- [x] **P1 — Backend reach.** auth (login/session/rate-limit), config envs, events SSE,
      import multipart upload → analyze/apply via unchanged commands, assets route
      (`/api/assets/:id?token=`), AI proxy with SSE passthrough (`/api/ai-proxy/:id/*`),
      SPA serving + fallback, `TANWORDS_MASTER_KEY` + file-backed Turso token path in core;
      desktop default build unaffected. Curl-verified.
- [x] **P2 — Shell + Settings + Vocabulary.** Responsive shell (desktop sidebar / mobile bottom
      tab bar with safe-area), settings sections (providers, learning, general, documents,
      data w/ web import-export), Words & Sentences incl. NEW FSRS ReviewPanel (was UI-missing
      upstream too: due-card fetch → reveal → 认识/困难/重来 grades), word detail full-screen
      modal on mobile, tap-target sweep.
- [x] **P3 — Reading + Feeds/Podcasts + player.** Article save/list/open, fetch-by-URL,
      enrichment; Feeds merged INTO Reading page as 订阅/播客 tabs (FeedsPanel kind=article|podcast,
      stay-mounted tabs), rss::* subscribe/sync/bookmarks, podcast player = shared
      HTMLAudioElement store + mini-bar docked above the mobile tab bar + NowPlaying
      full-screen sheet, PlaybackSpeedSelector ported. HN tab excluded (desktop-only value clamped defensively).
- [x] **P4 — AI Chat.** Sessions list as <lg drawer, visualViewport composer height, SSE stream
      parsing preserved against proxy (error phrasing kept for context-overflow matching),
      extraction cards mobile-wrapped, touch-visible row actions. Providers never send keys client-side.
- [x] **P5 — Docs.** DB-only documents page (localdocs removed incl. source tabs), mobile
      single-pane list→editor flow with back bar, document assets resolve via /api/assets/:id
      everywhere (editor thumbs, manager, export bytes kept base64-internal), privacy lock
      flows verified against web dispatch, export = HTML download / print-to-PDF tab,
      markdown import via file picker, worker chunk emitted by build (726 kB, split).
- [x] **P6 — Dashboard.** Responsive solo column on mobile, dead music quick-action fixed to
      Reading, stats + recents + quick actions all live against invoke.
- [ ] **P7 — Hardening & ship (PARTIAL).** Done: PWA manifest/icons/viewport-fit/theme-color, i18n
      parity both languages wherever pages were touched, typecheck+150 tests+build green, e2e smoke.
      Remaining: Dockerfile + self-host README for the web build (server README exists),
      192px PWA icon, ProviderSection pre-save validation TODO, real-device mobile keyboard QA,
      HTTPS deploy guide.
- [x] **P8 — Multi-user auth + per-user Turso.** Done + curl-verified: server-owned `users.db`
      (argon2id passwords, sha256'd sliding 30-day sessions, per-user Turso url+token sealed
      AES-GCM under TANWORDS_MASTER_KEY — now a required env; TANWORDS_INVITE_KEY gates register +
      reset-password, unset = closed); login = email+password. Per-user runtime pool
      (Registry+AppHandle per active user, cap 8 with idle-LRU evict, per-user SSE channel) —
      zero changes to command code. Saved-Turso-fails-open → per-user local DB + startup warning.
      Machine-global / path-taking commands blocked from /invoke; per-user /api/db/* + validated
      /api/import/* routes replace them. Frontend: AuthGate (login/register/forgot) + DataSection
      rerouted + account block w/ logout. Isolation proven live (two users, disjoint counts).

## 7. Decisions to confirm before / during P0

1. **Transport:** start on `/invoke` RPC (recommended, fastest to parity) — REST façade deferred.
   If you'd rather go REST-first, say so; it changes the schedule significantly. ✅/❌
2. **Deploy shape:** single self-hosted instance, single shared password. Multi-user accounts and
   per-user vocabularies are explicitly out for v1. ✅/❌
3. ~~**Speak button**~~ **Decided: removed entirely** — no TTS, no browser SpeechSynthesis.
   Podcast playback is the only audio on web.
4. ~~**Feeds/podcasts out**~~ **Decided: in scope.** Article feeds + podcasts + in-browser episode
   playback live as tabs inside Reading. Open sub-question: also include the HackerNews page?
   (`hn::*` commands already run server-side, so it's a small UI port.) ✅/❌
5. **Package runner:** `bun` like the desktop app (devDependency parity, vitest retained) or
   plain npm? Suggest bun for consistency.
6. Server binds `127.0.0.1` by default; exposure beyond LAN assumed behind your HTTPS
   reverse proxy (Caddy/nginx) — do you want built-in TLS too?

## 8. Testing strategy (web additions)

- Backend: `#[tokio::test]` axum-router tests (tower `ServiceExt::oneshot`) for auth, proxy,
  import/export; core already has tests for db/privacy — keep green.
- Frontend: vitest + testing-library for ported stores/pure libs (the ones that already have
  tests must keep passing under the web alias swap: `ipc/backend` → `api/client` via
  `vite.config` alias `@tanwords/api`).
- E2E smoke (manual script in P7): login → create word → review due card → chat stream →
  doc lock/unlock → export backup → import into desktop build (cross-compat check).

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Keychain-dependent secrets break on headless Linux | AI features dead; silent | §3.2 master-key env override + startup loud warning |
| Provider browser CORS | chat/enrichment broken on phones | §3.4 proxy-always decision |
| Attachment/assets via `/asset?path=` assumes local FS | doc images broken | `/api/assets/:id` blob route; strip path-based URLs in port |
| HTTPS deployment + HTTP-only podcast enclosure | browser blocks playback (mixed content) | validate/warn on feed subscribe (prefer HTTPS); if common in practice, add optional passthrough `/api/mediaproxy?url=` streamer later |
| `localdocs` filesystem commands exposed server-side | directory traversal surface | not mounted in web command set at all |
| sherpa/ONNX build weight | 10+ min builds, huge binary | feature flags early (P0) before anything else |
| Two-pane pages cramped on phones | poor UX | §4.3 single-pane navigation pattern per page |
| Session tokens in memory | logout on restart | acceptable; document; persisted-sessions later if annoying |
