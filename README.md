# TanWords

**English** | [简体中文](README.zh-CN.md)

An Electron desktop app with a Rust sidecar, for content-driven English
vocabulary and sentence-pattern learning, calibrated to CEFR C1/C2. The product
loop: **read a real article → AI extracts vocabulary and sentence patterns worth
learning → accept into a personal library → (vocabulary side only) FSRS
spaced-repetition review.**

Primary UI language is Chinese; the codebase (identifiers, comments) is English.

## Install

Download the latest `.dmg` from [Releases](https://github.com/FleetingEcho/TanWords/releases/latest)
— `-arm64` for Apple Silicon, the unsuffixed one for Intel.

### macOS: "TanWords is damaged and can't be opened"

This is expected on first install, and the app is not damaged. I don't have a
paid Apple Developer account, so the build carries no Developer ID signature —
only an ad-hoc one. macOS quarantines anything downloaded from a browser and
refuses to launch an unsigned bundle. Two commands fix it permanently:

```bash
xattr -cr /Applications/TanWords.app
codesign --force --deep --sign - /Applications/TanWords.app
```

The second prints `replacing existing signature`, which is normal. Run both —
`xattr` alone is not enough: it only strips the quarantine flag, while the
bundle still fails signature validation (`Sealed Resources=none`) and macOS
keeps reporting it as damaged.

**You only need to do this once.** In-app updates download and verify their own
archive rather than going through the browser, so nothing gets quarantined and
later versions install without repeating these steps.

## Screenshots

### Dashboard — where every session starts

Resume an in-progress article, jump back into recent words/patterns/docs, and
reach every quick action from one home screen.

![Dashboard page — resume and quick actions](static/images/Dashboard.png)

### Words — full AI enrichment per word

Every word gets a freeform AI write-up (core meaning, common usage,
collocations, nuance vs. near-synonyms, etymology, memory aids) with 4-6+
real example sentences, plus a notes editor and a speak button on every
example. The word list is built for scanning, not scrolling.

![Words page — word detail](static/images/Words_2.png)

The same page's **Sentences** tab is a parallel library of reusable
sentence-pattern skeletons with slots, backed by the real sentence they came
from:

![Words page — Sentences tab](static/images/Sentences.png)

### Feeds — RSS articles and podcasts in one place

Subscribe to article feeds and podcasts side by side; podcast episodes play
in a persistent bottom player bar.

![Feeds page — articles and podcasts](static/images/Feeds.png)

Open an entry in the in-app reader to read it distraction-free, extract
vocabulary and patterns straight from the page, or hit "Play episode" to
start a podcast in the bottom player bar without leaving the page:

![Feeds page — in-app article reader](static/images/Feeds_2.png)

![Feeds page — podcast episode detail](static/images/Play_Episode.png)

### Hacker News — built-in reader, no browser tab needed

Browse Top/New/Best right inside the app:

![Hacker News page — front page listing](static/images/Hacker_News.png)

Open any story to read it alongside its full threaded comments, then send it
straight into Reading to extract vocabulary and patterns:

![Hacker News page — story with threaded comments](static/images/Hacker_News_Comments.png)

### Music — learn while listening to your local library

Browse local music by artist and album, play or shuffle a collection, and
control the active queue from the persistent player with seeking, playback
speed, and track navigation.

![Music page — local album and persistent player](static/images/Music.png)

### Settings — on-device TTS voices, and your own cloud database

Scan local model directories or download recommended Kokoro/Piper voices
right from Settings, preview a voice before committing, and adjust playback
speed — all speech synthesis runs on-device, no network call at speak-time.

![Settings page — TTS voice model setup](static/images/TTS_Model.png)

Connect your own Turso database to sync one vocabulary across machines, or
stay fully local — switch between the two anytime from Settings › Data:

![Settings page — local vs. cloud database](static/images/Local_Cloud_DB.png)

### Documents & AI Chat — first-class pages in the nav

Docs and AI Chat live right in the sidebar: a personal notes editor
(BlockNote, full-text search, tags) and a multi-session AI chat, both a
single click away from anywhere in the app.

![Docs page — local folder view](static/images/Documents.png)

![AI Chat page — conversation with tool use](static/images/AI_Chat.png)

## Repo layout

```
app/
  src/        # React + TypeScript renderer (~42k LOC incl. electron/)
  src/ipc/    # Typed client for the sidecar's HTTP API + SSE event stream
  electron/   # Electron main process & preload — windows, tray, updater,
              # browser panel, sidecar lifecycle. No app data logic lives here.
  core/       # The Rust sidecar (~15k LOC): SQLite/libsql, AI orchestration,
              # TTS, RSS, MCP server. Ships as one static binary.
docs/         # Audio-player internals, Windows build notes.
scripts/      # Release helpers.
```

## Stack

- **Renderer** (`app/src/`): React 18 + TypeScript + Tailwind + Zustand, Vite,
  BlockNote (document editor).
- **Shell** (`app/electron/`): Electron main process — window/tray lifecycle,
  the updater, the embedded browser panel, and supervising the sidecar. It is
  deliberately *not* in the data path.
- **Backend** (`app/core/`): Rust, `libsql` (SQLite, WAL mode) — one API covering
  both a local database file and a Turso embedded replica, see "Online database"
  below. Runs as a sidecar process, not as a Node server.
- **AI**: bring-your-own-key, OpenAI-compatible providers (OpenAI, Anthropic/Claude,
  DeepSeek presets, or any local model via Ollama/LM Studio). Keys are encrypted
  at rest and scoped to the device that entered them — see "AI providers" below.
- **TTS**: embedded on-device speech synthesis via `sherpa-rs`/sherpa-onnx —
  Kokoro and Piper/VITS voices, no external binary or network call at speak-time.
  Downloadable voice models, pluggable model directories, sentence-by-sentence
  article playback, and per-word/example "speak" buttons throughout the app; falls
  back to the browser's `speechSynthesis` if no local model is loaded.
  Article playback is pipelined rather than batched: the model is loaded on
  demand, only the sentence about to play is awaited, and the next couple of
  sentences are synthesized in the background while it plays. Synthesis itself
  runs off the async runtime on a dedicated blocking thread, so the UI stays
  responsive while sentences are generated.

## Under the hood

The app started on Tauri v2 and moved to Electron. That direction usually costs
size and memory, so most of the work since has gone into not paying that bill.
Every number below is measured, before → after.

### A Rust sidecar, not a Node backend

There is no application logic in the Electron main process. All data access, AI
orchestration, TTS, RSS and the MCP server live in one statically linked Rust
binary that the main process spawns and supervises. It serves a loopback HTTP
API on an ephemeral port, gated by a bearer token handed to the renderer through
the preload handshake, with an SSE stream for events. The renderer talks to it
directly.

Commands are plain Rust functions marked with an attribute; a build script scans
the source and generates the dispatch table on every `cargo build`, so adding a
command is one function plus one line in a manifest — there is no hand-maintained
router to drift out of sync. 152 commands are wired this way today.

### Bundle: 202MB → 123MB arm64 zip, 344MB → 11MB asar

- **`node_modules` is not shipped.** All 27 production dependencies are renderer
  libraries Vite has already bundled into `out/renderer`, and vite-plugin-electron
  inlines the single main-process dependency into `out/main` — nothing resolves
  from the tree at runtime. Shipping it anyway made `app.asar` 344MB instead of
  **11MB**.
- **Fonts: 1.88MB → 0.17MB.** Monaspace shipped as a 1487KB WOFF1 Nerd Font
  build whose 9,390 PUA icon glyphs are used nowhere in the source; subsetting
  to WOFF2 gives **101KB**. Inter shipped 9 weights × 2 formats where the app
  uses 4 weights and Chromium never needs the WOFF fallback.
- **Electron locale packs: 220 → 2.** Electron's framework ships ~47MB of
  Chromium locale `.pak` files by default; only `en` and `zh_CN` are needed by
  this app, and `electronLanguages` drops the rest from every target. On the
  current arm64 build this takes the zip from 129MB to 123MB.
- **Main chunk: 3.69MB → 1.73MB.** BlockNote was being pulled into the entry
  chunk by modules that only wanted a text-extraction helper; it is now a
  dynamic import behind a cached promise, in its own chunk. All 9 routes are
  code-split (7 used to be eager) and load on first navigation, so unused
  routes do not stay resident in the renderer. Global overlays (word detail,
  tools modal, podcast bar) are also lazy and only load when first opened.
- **TTS runtime linked statically.** Moving to k2-fsa's official `sherpa-onnx`
  removed the dylib staging in `build.rs`, the platform rpaths, and the
  per-platform `sherpa-libs` payload from all three targets.

### Memory

- **Browser panel tabs were unbounded** — one full renderer process each, never
  reclaimed. Now Chrome-style LRU discard (2 live tabs): the process is freed and
  the page reloads from its URL on return.
- **Chromium's spare renderer is disabled** (a permanently idle ~60–90MB process)
  and the V8 heap is capped — measured 3586MB → **631MB** limit.
- **The document worker** held a live editor instance forever after a single
  parse; it now terminates after 30s idle.
- **The TTS model is no longer preloaded at startup.** It loads on demand and is
  released again after 5 minutes without synthesis, so the 60–120MB session is
  not charged to launches that never speak or to users who leave reading idle.

### Speech that doesn't block

Article playback is pipelined rather than batched: only the sentence about to
play is awaited, the next few are synthesized in the background, and synthesis
runs on a dedicated blocking thread rather than the async runtime — so the UI
stays responsive while audio is generated.

### An updater that works without $99/year

Electron's macOS updater delegates to Squirrel.Mac, which rejects any update
whose code signature doesn't match the running app's. Without an Apple Developer
ID the app is only ad-hoc signed, and an ad-hoc identity is derived from the
binary's own hash — it changes every build, so that check can *never* pass. Auto
-update on macOS was structurally dead, not misconfigured.

So macOS gets its own updater: releases are signed with ed25519 (Node's built-in
crypto, no dependency), and the client verifies the signature over the archive
bytes **before** anything is unpacked. Installation is handed to a detached
script that waits for the app to exit, moves the old bundle aside, swaps in the
new one, restores it if the swap fails, and relaunches. Windows and Linux keep
`electron-updater`; both sit behind the same interface, so the renderer is
unchanged.

### Schema and data

26 forward-only migrations, each applied once inside a transactional batch and
stamped in the same round-trip — a migration cannot half-apply and then replay
on the next launch. The same code path drives a local SQLite file and a Turso
embedded replica.

## AI providers

Bring your own key. Built-in OpenAI and Claude, a DeepSeek preset, and any
OpenAI-compatible endpoint (Ollama, LM Studio, or a hosted service) as a custom
provider.

Provider configuration lives in the database, with two properties worth calling
out:

- **API keys are encrypted at rest** (AES-256-GCM) under a master key held in the
  OS keychain, which the renderer can never read. Listing providers returns only
  whether a key exists; the plaintext takes a separate, explicit call.
- **Providers are scoped to the device that added them.** The device id is part
  of the primary key, so if you sync via Turso, each machine sees only its own
  providers and rows that reach the primary are undecryptable anywhere else.
  Scoping is enforced by cryptography, not just by a query filter.

## Feature pages

| Page | What it does |
|---|---|
| Dashboard | Resume an in-progress article, recent words/patterns/docs, quick actions. |
| Reading | Paste an article → AI extracts words + sentence patterns → accept individually or in bulk; click-any-sentence close reading; "listen to article" plays it back sentence-by-sentence with the embedded TTS engine, highlighting as it goes. |
| Feeds | Subscribe to RSS articles and podcasts side by side; browse Hacker News (Top/New/Best, full threaded comments) in-app; pull an article into Reading via an in-app reader or paste-back; the in-app reader also has "listen to article"; podcast episodes play in a persistent bottom player bar. |
| Knowledge Map | Enter any word, scene, or topic and build a persistent 2.5D map of related vocabulary and phrases; expand any branch progressively and add selected items to Vocabulary/FSRS. |
| Vocabulary | Master-detail word browser with full AI enrichment (freeform explanation, examples, collocations, etymology, mnemonics), FSRS review, time-range filtering (added/updated), and a speak button on every word/example. |
| Patterns | A parallel library for sentence patterns (skeleton + slots), tagged by rhetorical function, backed by real example sentences from the articles they came from. |
| Discover | Generate a themed vocabulary batch by topic, or explore a word family from a root/affix. |
| Documents | Personal notes editor (BlockNote), full-text search (SQLite FTS5), tags, pinning. |
| AI Chat | Multi-session chat with tool-use that can write directly into the app's data. |
| Settings | Provider config, CEFR target level, TTS voice model/speed (scan directories, download recommended Kokoro/Piper voices, add custom directories), switchable DB location, online database connection, backup export. |

## Online database (optional)

By default everything lives in one local SQLite file and no account is needed.
To share one vocabulary across machines, connect **your own** Turso database
under Settings › Data:

```bash
turso db create tanwords
turso db show tanwords --url          # → libsql://…  goes in "Database URL"
turso db tokens create tanwords       # → token       goes in "Auth token"
```

> **Note**: appearance settings (avatar, nickname, background image, theme, highlight
> colour, TTS voice, sidebar layout) live in the database too. Against an empty online
> database they fall back to defaults, which looks like a reset — your original local
> database is untouched and can be re-mounted anytime.

A full local copy is kept afterwards (an embedded replica), so reads stay at
local speed and offline reading still works; writes are forwarded to your
primary and synced both ways in the background. The token is stored in the OS
keychain and can't be read back from the UI. Backup export and switching the
database file are local-profile only — neither is meaningful for a replica.

**Moving existing local data in**: Settings › Data › "Import from a local database"
takes any TanWords database file and shows a preview first — grouped by words,
patterns, articles and documents, with a count of what's new and a side-by-side
existing-vs-incoming list of what already exists. Tick the rows to overwrite,
leave the rest, and it applies in one transaction. Re-importing the same file
changes nothing. Overwrites never touch FSRS review progress, and settings
(including the MCP token) are never imported.

You can disconnect at any time: your current vocabulary is saved to a standalone
local database file first and carries over, and nothing on the remote is touched.
While offline, reads keep working from the local replica (marked read-only) and
writes fail loudly rather than being silently lost.

The database belongs to your own Turso account; this project hosts nothing.

## Getting started

Requires [Bun](https://bun.sh) and a Rust toolchain.

```bash
cd app
bun install
bun run dev          # builds the Rust sidecar (debug), then starts Electron + Vite
```

Other useful scripts:

```bash
bun run typecheck    # tsc over both the renderer and electron/
bun run test:run     # vitest
bun run package:mac  # dmg + zip into dist-releases/ (also :linux, :win)
cd core && cargo test
```

> `bun run dev` prefers `core/target/release/tanwords-core` if one exists, so
> after a release build run `cargo build` again (or delete the release binary)
> or the dev app will keep launching the stale one.

## Further reading

- [`docs/audio-player.md`](docs/audio-player.md) — audio playback internals.
- [`docs/build-windows.md`](docs/build-windows.md) — Windows build notes.
