# TanWords Admin

Local admin tool for the TanWords SQLite database. Runs entirely on your machine,
independent of the desktop app — use it to browse/edit any table, or batch-generate
content with a local (Ollama/LM Studio) or cloud OpenAI-compatible model without
opening TanWords.

There are two separate ways to generate content here, for two different needs:

- **Web UI batch-generate** — words only, interactive, preview-then-commit.
- **`generate-cli.mjs`** — words, articles, sentence patterns, documents, and
  backfilling AI analysis onto existing words, all from the command line, no
  UI required. This is the one to reach for when you want to point a local
  model at the app and let it run unattended.

## Setup

```bash
npm install
npm run dev
```

This starts the API server on `http://127.0.0.1:5198` and the web UI on
`http://localhost:5199`. Open the web UI in a browser.

By default everything in this tool (web UI and CLI alike) connects to the same
database the desktop app uses:

- macOS: `~/Library/Application Support/tanwords/tanwords.db`
- Windows: `%APPDATA%/tanwords/tanwords.db`
- Linux: `~/.local/share/tanwords/tanwords.db`

Override the web server's DB with `npm run server -- --db=/path/to/tanwords.db`,
or the CLI's with a `dbPath` key in `generate.config.json` (see below).

WAL mode means this tool can read and write while the TanWords app is open.

## Table Browser (web UI)

Every table in the database, searchable, with inline cell editing and row
deletion. Works generically for any table (uses SQLite's `rowid`), so new
tables the app adds later show up automatically.

## Batch Generate (web UI) — words only

Paste a word list (or a CSV/text file's contents), point it at any
OpenAI-compatible endpoint, preview the generated definitions/examples, edit
inline, and commit the ones you want. Automatically skips words already in
your vocabulary or marked as known. Good for a quick one-off list where you
want to eyeball results before they land in the DB.

## `generate-cli.mjs` — batch content generation from the command line

For everything beyond "a list of words with preview": whole articles with
extracted vocabulary/patterns, sentence-pattern library entries, study-note
documents, and backfilling full AI analysis onto words that only have a bare
translation. No preview step — it writes straight to the DB, but always backs
it up first (see [Safety](#safety-what-every-run-does-automatically) below).

### Configure

```bash
cp generate.config.example.json generate.config.json   # gitignored, your local copy
```

Edit `generate.config.json`:

```json
{
  "baseUrl": "http://localhost:1234/v1",
  "apiKey": "",
  "model": "qwen2.5-14b-instruct",
  "targetLevel": "C1"
}
```

| Key | Meaning |
|---|---|
| `baseUrl` | Everything before `/chat/completions`. Ollama: `http://localhost:11434/v1`. LM Studio: `http://localhost:1234/v1`. vLLM / llama.cpp server: whatever host:port you bound it to. Any cloud OpenAI-compatible endpoint works too. |
| `apiKey` | Leave `""` for local servers that don't check it. |
| `model` | Model name/tag as your endpoint expects it (e.g. `qwen2.5-14b-instruct`, `llama3.1:8b`). |
| `targetLevel` | CEFR level to calibrate generated content to (`B2`/`C1`/`C2`). Defaults to `C1`. |
| `dbPath` | Optional. Override the DB file the CLI writes to (same override options as the desktop app's own "switch database" setting). |

### Run

```bash
npm run generate <mode> [options]
# equivalently: node server/generate-cli.mjs <mode> [options]
```

| Mode | What it does | Options |
|---|---|---|
| `words` | Invents new vocabulary on given topics, with full enrichment (definitions, synonyms, antonyms, collocations, etymology, mnemonic). Skips words already in the vocab. | `--topics "AI,climate,economics"` `--count 30` |
| `articles` | Writes short original essays and extracts learnable words/patterns from them, verified to appear verbatim in the essay text (so in-app highlighting works). | `--topics "remote work,open source"` `--count 5` |
| `patterns` | Adds entries to the sentence-pattern library — skeleton, meaning, function tag, structural analysis, example sentences. Folds into an existing pattern (appending an example) instead of duplicating if the skeleton already exists. | `--skeletons "not so much X as Y,..."` (specific patterns) or `--count 15` (let the model invent them) |
| `documents` | Writes study-note documents (BlockNote format, same as the app's Documents page) — reading notes, vocab reviews, project retrospectives. | `--topics "读书笔记,项目复盘"` `--count 5` |
| `enrich` | **Backfills** full AI analysis onto words that are already in the vocabulary but only have a bare word+translation (e.g. accepted straight from a reading lesson) — never inserts new words. | `--count 50` (words missing enrichment, default) · `--all` (re-enrich every word regardless of current state) · `--words "resilient,tenuous"` (target specific words) |
| `all` | Runs `words`, `articles`, `patterns`, `documents`, then `enrich`, in that order, with each mode's defaults. | `--count 20` (applied to each mode) |

Examples:

```bash
npm run generate words -- --topics "distributed systems,negotiation" --count 40
npm run generate articles -- --count 6
npm run generate patterns -- --skeletons "let alone X,for all X, Y"
npm run generate documents -- --topics "本周精读笔记"
npm run generate enrich -- --all
npm run generate all -- --count 15
```

(The `--` before the flags is npm's separator so it forwards them to the
script instead of trying to parse them itself — required when using `npm run`,
not needed when calling `node server/generate-cli.mjs <mode>` directly.)

### Safety: what every run does automatically

- **Backs up the DB first**, every time, to `tanwords.db.backup-<ISO timestamp>`
  right next to the real file (plus `-wal`/`-shm` if present). Nothing is ever
  wiped by this script — restore by copying a backup back over `tanwords.db`
  (with the app closed).
- **Applies the `patterns`/`pattern_examples` migration on first use** if the
  DB predates it, so this works even against an older DB the desktop app
  hasn't relaunched against yet.
- **Words**: `UNIQUE(word)` at the DB level means re-running `words` with
  overlapping topics just skips duplicates — never overwrites an existing
  word's data.
- **Patterns**: dedups by skeleton text (case/whitespace-insensitive). A
  second run that regenerates a pattern you already have appends a new
  example sentence to it instead of creating a duplicate entry.
- **Articles' extracted items are validated**: every extracted word/pattern's
  text must appear verbatim in the generated article, or it's dropped and
  logged — this is what makes in-app highlighting work, and it's the one
  correctness rule the model reliably breaks if you don't check for it.
- **`enrich` replaces, not appends**: re-running it on the same word (e.g.
  via `--all` twice) swaps out that word's old definitions/etymology rather
  than accumulating duplicate rows.
- Retries once per model call on a malformed/unreachable response, then logs
  and moves on to the next batch rather than aborting the whole run.

### Why a separate CLI instead of extending the web UI

The web UI's batch-generate is deliberately words-only, synchronous, and
preview-first — good for small, supervised additions. The CLI is for the
opposite case: pointing a local model at the app and generating a meaningful
amount of content (articles with real extracted vocabulary, a sentence
pattern library, study notes) unattended, where a preview step for every item
would just be friction. Both talk to the same kind of OpenAI-compatible
endpoint; there was no reason to duplicate the model-calling logic, they're
just optimized for different workflows.

## Architecture

- `server/index.ts` — Hono API (table CRUD + web UI's word batch-generate),
  `better-sqlite3` for direct DB access. Port `5198`.
- `server/generate-cli.mjs` — standalone script, not part of the API server;
  talks to `better-sqlite3` and your configured model endpoint directly.
- `web/` — Vite + React + Tailwind, the Table Browser and Batch Generate UI.

No authentication — this is a single-user local tool bound to `127.0.0.1`.
