# Plan: Replace patterns with a `sentences` table + collapse migrations into a fresh schema

## What you decided
1. **Replace** `patterns` + `pattern_examples` + `pattern_practice` with a single first-class `sentences` table (you save nice sentences from websites).
2. **Clean up `app/core/src/db/migrations`** — pure new schema, **breaking change**, no old-DB/old-app/old-service support.
3. Metadata field: **`starred`** (from the list I offered).

## The big simplification (the win from "breaking change")
Because old databases are **not** supported, there is **no backfill, no migration history**:
- Delete the entire `db/migrations/` directory (7 files, 1096 lines) + the `migrations::run()` runner + the `schema_migrations` table.
- Move all the feature tables currently created **inline** in `init_db_sqlite` (documents, ai_chat, calendar, articles, document_assets, standalone_assets, r2_config, etc. — ~200 lines of `CREATE TABLE`/`ALTER TABLE ... .ok()`) into `sql/schema.sql` so it becomes the **single source of truth** for the SQLite schema.
- `init_db_sqlite` shrinks to: fingerprint check → `execute_batch(schema.sql)` → seed defaults → stamp. (Postgres `init_db_postgres` already works this clean way — unchanged in shape.)
- A fresh DB is built from the schema files; an old DB simply won't match the fingerprint and the user starts fresh (breaking, as you said).

## Dead tables removed as part of cleanup
| Table | Where | Why dead |
|---|---|---|
| `sentences` + `sentence_words` | `schema.sql` (SQLite) | No Rust code reads/writes `FROM sentences` — vestigial old design |
| `saved_sentences` | both (migration 20 + `schema_postgres.sql`) | Created by migration 20, never wired to a command — the abandoned original "save sentence" feature |
| `patterns` + `pattern_examples` + `pattern_practice` | both | Replaced by the new `sentences` table |

## New `sentences` table (both backends)
```sql
-- SQLite
CREATE TABLE IF NOT EXISTS sentences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence    TEXT NOT NULL,
  zh          TEXT NOT NULL DEFAULT '',
  level       TEXT,                         -- A1–C2, nullable
  note        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',     -- 'chat' | 'website' | …
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  starred     INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sentences_created ON sentences(created_at DESC);
-- Postgres: BIGINT GENERATED ALWAYS AS IDENTITY, starred BIGINT CHECK(starred IN (0,1)),
--           timestamps via to_char(now() AT TIME ZONE 'UTC', ...), article_id BIGINT REFERENCES …
```

## ✅ Sub-decisions CONFIRMED by user

**A. Field set — KEEP existing fields + add starred.** `zh/level/note/source/article_id` stay (the save flow's AI translation/grading needs them); add `starred`. "Only starred" meant "don't add tags/status/enrichment", not "strip existing fields".

**B. Re-analyze — KEEP, renamed.** `db_update_sentence(id, zh, note, level)` regenerates translation/note/level; sentence text stays immutable (you liked it as-is); the AI `skeleton/template` concept is dropped. The re-analyze UI button keeps working.

**C. i18n keys — RENAME to `vocab.sentences.*`.** Scope: 2 i18n files (`en/vocabulary.ts`, `zh/vocabulary.ts`, 49 keys each) + 6 component/test files calling `t("vocab.patterns.…")`:
`components/Vocabulary/{PatternLibrary,SentenceList,SentenceModal}.tsx`, `components/shared/SentenceSearchBox.{tsx,test.tsx,dismiss.test.tsx}`. Mechanical `vocab.patterns` → `vocab.sentences` replace.

## Command surface (Rust)
Replace 6 pattern commands → 5 sentence commands (dispatch count changes from 199):
- `db_list_sentences` → `Vec<SentenceItem>`
- `db_save_sentence(sentence, zh, note, level, source)` → `{ id, created }` (dedup by sentence text)
- `db_delete_sentence(id)`, `db_delete_sentences_batch(ids)`
- `db_set_sentence_starred(id, starred)`
- `db_update_sentence(id, zh, note, level)` — the re-analyze/edit command *(if you keep it per B)*

`SentenceItem { id, sentence, zh, level: Option, note, source, article_id: Option, starred, created_at, updated_at }` — **flat, no `examples` array, no `pattern` field**.

## Files changed
**Rust (app/core):** `sql/schema.sql`, `sql/schema_postgres.sql`, `src/db/mod.rs` (gut `init_db_sqlite`), delete `src/db/migrations/`, `src/db/patterns.rs`→`src/db/sentences.rs`, `src/db/dashboard.rs` (`pattern_count`→`sentence_count`), `tests/seaorm_command_smoke.rs`.
**Rust (web/server):** `src/commands.rs` (swap the 6 pattern classifications → 5 sentence ones).
**Frontend (app/src):** `hooks/useDB.patterns.ts`→`useDB.sentences.ts`, `hooks/useDB.ts`, `components/Vocabulary/PatternLibrary.tsx`, `SentenceList.tsx`, `shared/SentenceSearchBox.tsx`, `sentenceSearch.ts`, `AiChat/SentenceExtractionCard.tsx`, `Dashboard/PatternsWidget.tsx`, `Vocabulary/VocabularyPage.tsx`, `AiChat/tools.ts` + all their `.test.*` files.
**i18n:** rename keys `vocab.patterns.*` → `vocab.sentences.*` (per C; 2 files + 6 call sites).

## Verification
- `cd app/core && cargo check` (note new dispatch count) + `cargo test`
- `cd app/core && cargo test --test seaorm_command_smoke -- --ignored sqlite` and `... postgres` (against `tanwords-pg-test` on :5433)
- `cd web/server && cargo test`
- `cd app && bun run typecheck` + `bun run test:run` (803 tests; mocks updated)

## Commit
One commit: `refactor: replace patterns with sentences table + collapse migrations into fresh schema (breaking)`.

## Execution order
1. Write `sql/schema.sql` fresh (merge inline feature tables + drop dead tables + add `sentences`).
2. Write `sql/schema_postgres.sql` fresh (drop dead tables + add `sentences`).
3. Rewrite `src/db/mod.rs` (`init_db_sqlite` → thin; delete `migrations` mod + `migrations::run`).
4. Delete `src/db/migrations/` directory.
5. Write `src/db/sentences.rs` (5 commands); delete `src/db/patterns.rs`.
6. Update `src/db/dashboard.rs` (`pattern_count` → `sentence_count`, query `sentences`).
7. Update `src/db/mod.rs` re-exports (`mod patterns` → `mod sentences`).
8. Update `tests/seaorm_command_smoke.rs` (swap pattern commands → sentence commands).
9. Update `web/server/src/commands.rs` (pattern classifications → sentence).
10. Frontend: `useDB.patterns.ts` → `useDB.sentences.ts`; update `useDB.ts` + all consumers + tests.
11. Verify all gates (Rust both crates + Postgres smoke; TS typecheck + test:run).
12. Commit + push.
