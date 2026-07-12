# TanWords

A Tauri v2 desktop app for content-driven English vocabulary and sentence-pattern
learning, calibrated to CEFR C1/C2. The product loop: **read a real article → AI
extracts vocabulary and sentence patterns worth learning → accept into a personal
library → (vocabulary side only) FSRS spaced-repetition review.**

Primary UI language is Chinese; the codebase (identifiers, comments) is English.

## Repo layout

```
app/     # The desktop app — React + TypeScript frontend, Rust/Tauri backend, SQLite DB.
         # See app/AGENT.md for the full architecture writeup.
admin/   # Standalone local admin tool for the same SQLite DB — table CRUD and
         # AI batch-generation (words/articles/patterns/documents), independent
         # of the desktop app. See admin/README.md.
```

## Stack

- **Frontend** (`app/`): React 18 + TypeScript + Tailwind + Zustand, Vite, BlockNote
  (document editor).
- **Backend** (`app/src-tauri/`): Rust, Tauri v2, `rusqlite` (SQLite, WAL mode).
- **Admin** (`admin/`): Node + Hono API + `better-sqlite3`, React/Vite web UI, plus a
  standalone CLI for unattended batch content generation.
- **AI**: bring-your-own-key, OpenAI-compatible providers (OpenAI, Anthropic/Claude,
  DeepSeek presets, or any local model via Ollama/LM Studio).
- **TTS**: embedded on-device speech synthesis via `sherpa-rs`/sherpa-onnx —
  Kokoro and Piper/VITS voices, no external binary or network call at speak-time.
  Downloadable voice models, pluggable model directories, sentence-by-sentence
  article playback, and per-word/example "speak" buttons throughout the app; falls
  back to the browser's `speechSynthesis` if no local model is loaded.

## Feature pages

| Page | What it does |
|---|---|
| Dashboard | Resume an in-progress article, recent words/patterns/docs, quick actions. |
| Reading | Paste an article → AI extracts words + sentence patterns → accept individually or in bulk; click-any-sentence close reading; "listen to article" plays it back sentence-by-sentence with the embedded TTS engine, highlighting as it goes. |
| HackerNews | Browse HN, pull an article into Reading via an in-app reader or paste-back; the in-app reader also has "listen to article". |
| Vocabulary | Master-detail word browser with full AI enrichment (definitions, synonyms/antonyms, collocations, etymology, mnemonics), FSRS review, and a speak button on every word/example. |
| Patterns | A parallel library for sentence patterns (skeleton + slots), tagged by rhetorical function, backed by real example sentences from the articles they came from. |
| Discover | Generate a themed vocabulary batch by topic, or explore a word family from a root/affix. |
| Documents | Personal notes editor (BlockNote), full-text search (SQLite FTS5), tags, pinning. |
| AI Chat | Multi-session chat with tool-use that can write directly into the app's data. |
| Settings | Provider config, CEFR target level, TTS voice model/speed (scan directories, download recommended Kokoro/Piper voices, add custom directories), switchable DB location, backup export. |

## Getting started

```bash
cd app && npm install && npm run tauri dev   # desktop app
cd admin && npm install && npm run dev       # admin tool (table browser + batch generate)
```

## Further reading

- [`app/AGENT.md`](app/AGENT.md) — full architecture, data access patterns, known
  gotchas, and conventions for the desktop app.
- [`admin/README.md`](admin/README.md) — admin tool setup, table browser, and the
  `generate-cli.mjs` batch-generation modes.
