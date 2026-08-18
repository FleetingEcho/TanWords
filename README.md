# TanWords

**English** | [简体中文](README.zh-CN.md)

TanWords is a desktop app for content-driven English learning, built with Electron and a Rust sidecar. It is designed for advanced learners (CEFR C1/C2) around one loop:

> Read a real article -> AI extracts vocabulary and sentence patterns -> save the useful parts to a personal library -> review words with FSRS.

The UI is Chinese-first; the codebase is written in English.

## Web version

A browser-based edition (desktop + mobile, multi-user with invite-key
registration and per-user Turso) lives in [`web/`](web/README.md). It is not a
port: it links the same Rust crate and serves the same renderer as the desktop
app, so a feature written once ships to both. See
[One codebase, two products](#one-codebase-two-products).

### Start the web version

Prerequisites: Bun and Rust.

1. Build the shared renderer once:

   ```bash
   cd app
   bun install
   bun run build
   ```

2. Start the web server:

   ```bash
   cd ../web/server
   TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
   TANWORDS_INVITE_KEY=choose-a-key \
   cargo run --release
   ```

3. Open `http://127.0.0.1:8740` and register with the invite key.

To reach it from a phone on the same LAN:

```bash
cd web/server
TANWORDS_HOST=0.0.0.0 \
TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
TANWORDS_INVITE_KEY=choose-a-key \
cargo run --release
```

Then open `http://<your-computer-ip>:8740`.

After everyone has registered, restart the server without
`TANWORDS_INVITE_KEY` to close registration and password reset.

See [`web/server/README.md`](web/server/README.md) for environment variables
and deployment notes.

### Single-binary deployment

The renderer is embedded into the Rust server binary, so deployment only needs
one executable. Verified steps:

- `cargo build --release` succeeds.
- Without `TANWORDS_WEB_DIST`, startup logs `serving embedded SPA`.
- `http://127.0.0.1:8741/` returns `200 OK`.

Build the single file:

```bash
cd app
bun run build

cd ../web/server
cargo build --release
```

Artifact:

```text
web/server/target/release/tanwords-web-server
```

Deploy by copying only that binary and running it:

```bash
TANWORDS_MASTER_KEY=... \
TANWORDS_INVITE_KEY=... \
TANWORDS_HOST=0.0.0.0 \
TANWORDS_PORT=8740 \
./tanwords-web-server
```

`TANWORDS_WEB_DIST` is optional; set it only when you want to serve an external
frontend directory instead of the embedded copy.

## Highlights

- **Learn from real content.** Paste an article, open an RSS feed, or read Hacker News inside the app. AI extraction works against the real text instead of a generic word list.
- **Deep word enrichment.** Each saved word gets a freeform AI write-up covering core meaning, usage, collocations, nuance versus near-synonyms, etymology, and memory aids, with real example sentences.
- **Sentence patterns as first-class items.** The Sentences/Patterns library stores reusable skeletons with slots, anchored to the real sentences they came from.
- **Reading, feeds, podcasts, and Hacker News in one place.** The built-in reader removes distractions, extracts vocabulary, reads articles aloud, and can open an episode in the persistent podcast player.
- **FSRS spaced repetition.** Vocabulary review is built in, so saved words can become a daily review queue.
- **Private by default.** Data lives in a local SQLite file. Optionally connect your own Turso database to sync across machines, and your own Cloudflare R2 bucket for the videos and audio a database has no business holding.
- **On-device TTS.** Kokoro/Piper voices run locally with no network call at speak time, including sentence-by-sentence article playback.
- **Documents and AI chat.** The sidebar includes a BlockNote document editor and a multi-session AI chat with tool use.

## Screenshots

### Dashboard

Resume an in-progress article, jump back into recent words, patterns, and documents, and reach every quick action from one home screen.

![Dashboard page - resume and quick actions](static/images/Dashboard.png)

### Vocabulary and Sentence Patterns

Every word gets a full AI write-up, multiple real example sentences, a notes editor, and a speak button on each example. The list is built for scanning rather than endless scrolling.

![Words page - word detail](static/images/Words_2.png)

The Sentences tab is a parallel library of reusable sentence-pattern skeletons with slots, backed by the real sentence each pattern came from.

![Words page - Sentences tab](static/images/Sentences.png)

### Feeds, Podcasts, and the In-App Reader

Subscribe to article feeds and podcasts side by side. Podcast episodes play in a persistent bottom player bar.

![Feeds page - articles and podcasts](static/images/Feeds.png)

Open an entry in the in-app reader to read distraction-free, extract vocabulary and patterns directly from the page, or start a podcast episode without leaving the current view.

![Feeds page - in-app article reader](static/images/Feeds_2.png)

![Feeds page - podcast episode detail](static/images/Play_Episode.png)

### Hacker News

Browse Top, New, and Best inside the app, then open a story with its full threaded comments and send it into Reading for vocabulary extraction.

![Hacker News page - front page listing](static/images/Hacker_News.png)

![Hacker News page - story with threaded comments](static/images/Hacker_News_Comments.png)

### Music

Browse local music by artist and album, play or shuffle a collection, and control the queue from the persistent player with seeking, playback speed, and track navigation.

![Music page - local album and persistent player](static/images/Music.png)

### Settings, TTS, and Data

Scan local model directories or download recommended Kokoro/Piper voices from Settings, preview a voice before committing, and adjust playback speed. All speech synthesis runs on-device.

![Settings page - TTS voice model setup](static/images/TTS_Model.png)

Connect your own Turso database to sync one vocabulary across machines, or stay fully local. Switch between the two anytime from Settings > Data.

![Settings page - local vs cloud database](static/images/Local_Cloud_DB.png)

### Documents and AI Chat

Docs and AI Chat are first-class pages in the sidebar: a personal notes editor with full-text search and tags, plus a multi-session AI chat that can read and write app data through tools.

![Docs page - local folder view](static/images/Documents.png)

![AI Chat page - conversation with tool use](static/images/AI_Chat.png)

## Install

Prebuilt installers for macOS, Windows, and Linux are published on the
[Releases](https://github.com/FleetingEcho/TanWords/releases) page. Grab the
file for your platform from the latest release that has it.

### macOS

Download the `.dmg`. Choose the `-arm64` file on Apple Silicon and the
unsuffixed file on Intel.

#### "TanWords is damaged and can't be opened"

This is expected on first install, and the app is not damaged. The build
carries an ad-hoc signature rather than a paid Developer ID signature, so macOS
quarantines a browser-downloaded bundle and refuses to launch it. Two commands
fix it permanently:

```bash
xattr -cr /Applications/TanWords.app
codesign --force --deep --sign - /Applications/TanWords.app
```

The second command prints `replacing existing signature`, which is normal. Run
both. `xattr` alone only strips the quarantine flag; the bundle still needs to
pass signature validation.

This setup is needed once. In-app updates download and verify their own archive
instead of going through the browser, so later versions install without
repeating these steps.

### Windows

Download `TanWords-Setup-x.y.z.exe` and run it. The installer is not signed
with a paid certificate, so SmartScreen may warn "Windows protected your PC";
click **More info → Run anyway** to continue.

### Linux

Download `TanWords-x.y.z.AppImage`, make it executable, and run it:

```bash
chmod +x TanWords-*.AppImage
./TanWords-*.AppImage
```

AppImages need FUSE to mount. On a minimal install, install `libfuse2`
(Debian/Ubuntu) or `fuse` (Fedora/RHEL) if the app fails to start.

## Quick Start

You need [Bun](https://bun.sh) and a Rust toolchain.

```bash
cd app
bun install
bun run dev
```

`bun run dev` builds the Rust sidecar in debug mode, then starts Electron and Vite.

Useful commands:

```bash
bun run typecheck    # TypeScript across the renderer and Electron main
bun run test:run     # Vitest
bun run package:mac  # DMG + zip into dist-releases/
cd core && cargo test
```

> After a release build, `bun run dev` may prefer `core/target/release/tanwords-core` if it exists. Run `cargo build` again or remove the release binary so the dev app does not keep launching a stale sidecar.

## Feature Pages

| Page | What it does |
| --- | --- |
| Dashboard | Resume an in-progress article; recent words, patterns, and documents; quick actions. |
| Reading | Paste an article, extract words and sentence patterns with AI, accept items individually or in bulk, read sentence by sentence, and listen to the whole article with embedded TTS. |
| Feeds | Subscribe to RSS articles and podcasts side by side; browse Hacker News Top/New/Best with threaded comments; open articles in the in-app reader; play podcast episodes in the persistent player. |
| Knowledge Map | Build a persistent 2.5D map of related vocabulary and phrases from any word, scene, or topic; expand branches progressively; add selected items to Vocabulary/FSRS. |
| Vocabulary | Master-detail word browser with AI enrichment, examples, collocations, etymology, mnemonics, FSRS review, time-range filtering, and speak buttons. |
| Patterns | A parallel library for sentence patterns with slots, tagged by rhetorical function and anchored to real examples. |
| Discover | Generate a themed vocabulary batch by topic, or explore a word family from a root or affix. |
| Documents | BlockNote editor, SQLite FTS5 full-text search, tags, pinning, and document workflow tools. |
| AI Chat | Multi-session chat with tool use that can read and write app data. |
| Settings | AI providers, CEFR target level, TTS voice models and speed, database location, online sync, and backup/export. |

## Online Database (Optional)

By default, everything lives in one local SQLite file and no account is needed. To share one vocabulary across machines, connect your own Turso database in Settings > Data:

```bash
turso db create tanwords
turso db show tanwords --url          # -> libsql://... goes in "Database URL"
turso db tokens create tanwords       # -> token goes in "Auth token"
```

After connecting, the app keeps a full local replica, so reads stay local and offline reading still works. Writes are forwarded to your primary and synced in the background. The token is stored in the OS keychain and cannot be read back from the UI.

Appearance settings also live in the database. Against an empty online database they fall back to defaults, which can look like a reset, but your original local database is untouched and can be re-mounted anytime.

To move existing local data into an online database, use Settings > Data > "Import from a local database". The importer previews new and existing words, patterns, articles, and documents, lets you overwrite or skip each row, and applies the result in one transaction. Re-importing the same file changes nothing, and overwrites never touch FSRS review progress.

You can disconnect at any time. The current vocabulary is saved to a standalone local database file first, and nothing on the remote is touched. While offline, reads keep working from the local replica (marked read-only) and writes fail loudly instead of being silently lost.

The database belongs to your own Turso account; this project hosts nothing.

## Large Files (Optional)

A database is the wrong place for an 85 MB video. Turso proves it bluntly: the
write travels to the primary in a single message and comes back
`SQLITE_NOMEM`. So attachments split by size — small ones stay in the database
where they need no network and work offline, large ones go to object storage.

Connect a **Cloudflare R2** bucket in Settings > Data. R2's free tier is 10 GB
with **no egress charges**, which matters for video you re-watch:

1. In the Cloudflare dashboard, create an R2 bucket.
2. R2 > Manage R2 API tokens > Create API token, with **object read & write**.
3. Copy three values into Settings: account ID (32 hex), access key ID (32 hex),
   and secret access key (64 hex — *not* the ~40-character token value).
4. "Save and test" performs a real upload and delete before storing anything, so
   a wrong key fails there rather than on your first real upload.

From then on, files of **10 MB or more** go to the bucket and the database keeps
only the row; a toggle sends *everything* there instead. Playback streams
straight from R2 through a presigned URL, so a video seeks properly instead of
downloading in full first. Settings shows real bucket usage (a live listing, not
a local tally) and blocks uploads past 9 GB, short of the free allowance.

The configuration lives in the database you are connected to, sealed as a whole
with AES-256-GCM under a key held in the OS keychain. Two consequences worth
knowing: switching databases switches bucket, and on the web build every user
configures their own bucket — a synced copy of the row carries no usable
credential to another machine.

The bucket belongs to your own Cloudflare account; this project hosts nothing.

## AI Providers

Bring your own API key. TanWords includes OpenAI and Claude presets, a DeepSeek preset, and custom OpenAI-compatible endpoints such as Ollama or LM Studio.

Provider configuration lives in the database:

- **Keys are encrypted at rest** with AES-256-GCM under a master key held in the OS keychain. The renderer never reads the plaintext key directly.
- **Providers are scoped to the device that added them.** The device id is part of the primary key, so synced databases do not share provider credentials between machines.

## One codebase, two products

TanWords ships as a desktop app and as a self-hosted web app. They are not two
implementations that happen to agree — they are the same code, compiled twice.

`app/core` is built as both a binary and a library:

```toml
# app/core/Cargo.toml
[lib]
name = "tanwords_lib"

# web/server/Cargo.toml
tanwords_lib = { package = "tanwords", path = "../../app/core",
                 default-features = false, features = ["web"] }
```

So every command — vocabulary, documents, AI enrichment, RSS, sentence
patterns, FSRS scheduling, R2 uploads — exists once, in `app/core`. The desktop
build runs it as a sidecar binary that Electron supervises; the web build links
the same crate and mounts the same command table per signed-in user. The
renderer in `app/src` is likewise built once and used by both: Electron loads it
from a custom `app://` scheme, and the server embeds the same output into its
binary with `rust-embed`.

The scale of what that saves is visible in the line counts:

| | lines | what lives there |
| --- | --- | --- |
| `app/core/src` | ~18,000 | everything the product does |
| `web/server/src` | ~1,800 | accounts, sessions, routing, per-user databases, serving the SPA |

`web/server` implements no product logic at all. It answers one question the
desktop never has to ask — *whose data is this?* — and hands the rest to
`tanwords_lib`. A user's database is opened at `users/<id>/`, and the command
table is built against that connection, which is what makes the web build
multi-user without any command knowing that multi-user exists.

**Why it is worth the indirection.** A feature added to `app/core` appears in
both products the next time each is compiled; there is no second implementation
to keep in step and no class of bug where the two disagree. The only code that
should ever be written twice is code about *who is asking*: authentication,
per-user isolation, and the few capabilities that genuinely differ — the web
build has no local music library, no OS keychain, and no app lock (accounts
already gate it). Those differences are declared once, in
`src/platform/types.ts` and Cargo features, rather than discovered as drift.

### How `web/server` is put together

Seven files, each with one job:

| file | job |
| --- | --- |
| `main.rs` | Start-up: read the environment, open `users.db`, bind the port. |
| `config.rs` | Every knob, entirely environment-driven (`TANWORDS_MASTER_KEY`, `TANWORDS_INVITE_KEY`, `TANWORDS_DATA_DIR`, `TANWORDS_PORT`, …). |
| `auth.rs` | Bearer-token plumbing and a per-(bucket, IP) failure limiter. |
| `users.rs` | `users.db` — emails, argon2id password hashes, session tokens (sha256'd at rest), and each user's Turso credentials sealed with AES-256-GCM. Deliberately a *separate* database from any user's vocabulary. |
| `runtime.rs` | The per-user runtime pool. |
| `server.rs` | The axum surface: routes, session middleware, `/invoke` dispatch, assets, import/export, the AI proxy. |
| `embedded.rs` | Seven lines of `rust-embed` that compile the built renderer into the binary. |

`runtime.rs` is where multi-user actually happens, and it is worth reading if
you want to understand the design. Each signed-in user gets their own core
runtime — a `Registry` + `AppHandle` built around *their* database. Command
code keeps reading `State<AppState>` exactly as it does on the desktop; the
isolation comes from the runtimes being separate objects. Data, document-privacy
unlocks and SSE event streams are all per-runtime, so there is no place where a
command could accidentally reach across users, because a command has no way to
name another user's runtime.

The pool has a small ceiling and evicts idle entries. Dropping an entry drops
the last `Arc`, which drops the `Registry`, which closes the `Db` — closing a
local file costs nothing, and a Turso replica merely stops its background sync
and re-syncs from the primary next time. This is a self-hosted app for invited
users, not a public service, so a large pool would buy nothing.

## Architecture

TanWords uses a thin Electron shell and a statically linked Rust sidecar:

- **Renderer** (`app/src/`): React, TypeScript, Tailwind CSS, Zustand, Vite, and BlockNote.
- **Shell** (`app/electron/`): Electron main process and preload, handling windows, tray, the embedded browser panel, the updater, and sidecar lifecycle. It deliberately stays out of the data path.
- **Backend** (`app/core/`): Rust with `libsql` (SQLite in WAL mode). One API supports both a local database file and a Turso embedded replica.
- **IPC**: the renderer talks to the sidecar over a loopback HTTP API on an ephemeral port, gated by a bearer token passed through the preload handshake, with an SSE stream for events.
- **Commands**: Rust commands are annotated and a build script generates the dispatch table, so there is no hand-maintained router to drift out of sync.
- **TTS**: embedded `sherpa-onnx` voices run locally, with on-demand model loading, sentence-by-sentence article playback, and fallback to the browser speech engine.
- **Updater**: macOS releases are signed with ed25519 and verified before unpacking; Windows and Linux use `electron-updater`.

The codebase is organized to keep business logic out of Electron:

```
app/
  src/        # React + TypeScript renderer
  src/ipc/    # Typed client for the sidecar HTTP API and SSE events
  electron/   # Electron main process and preload
  core/       # Rust sidecar: data, AI, TTS, RSS, MCP server
docs/         # Feature and build notes
scripts/      # Release helpers
```

## Build and Release

macOS packaging:

```bash
cd app
bun run package:mac
```

Linux and Windows variants:

```bash
bun run package:linux
bun run package:win
```

Release outputs land in `dist-releases/`. macOS updater metadata is generated with:

```bash
node app/scripts/sign-release.mjs
```

## Further Reading

- [`docs/audio-player.md`](docs/audio-player.md) - audio playback internals.
- [`docs/build-windows.md`](docs/build-windows.md) - Windows build notes.
