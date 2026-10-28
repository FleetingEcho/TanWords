# TanWords — Scene-Tagged Words + Scenario Learning Module

> Status: draft for review — not started · 2026-10-27 · Owner: zteng · Repo: `/home/zteng/work/Tools/TanNotes` (branch `main`)
> Companion to, but independent of, the dormant scene-lab experiment. Nothing in this plan touches scene-lab's tables or code paths.

## 1. Background & motivation

### 1.1 The pedagogical insight (user, 2026-10-27)

The user's thesis: the fastest route to fluent spoken English and reliable listening
comprehension is **scenario-based preparation**. Instead of learning words in the
abstract, you drill one real-life scenario (ordering coffee, airport check-in, a
doctor's visit, a job interview) until its entire common exchange space is automatic:

- **Predictive listening**: if you already know what the barista *might* ask
  ("For here or to go?", "What size?", "Can I get a name?"), you recognize it
  instantly when heard — top-down processing does the work that raw decoding
  can't do at conversation speed.
- **Prepared production**: answers are rehearsed, so speaking is retrieval, not
  on-the-fly sentence construction. Four simultaneous tasks (hear → parse →
  compose → articulate) collapse into one.
- **Variants, not scripts**: the same intent surfaces as many phrasings
  ("Anything else?" / "Will that be all?" / "Is that everything?"). Training must
  group by *intent*, not memorize one fixed Q&A pair.
- **Unexpected situations**: real dialogue deviates. Repair lines
  ("Sorry, could you say that again?", "Let me think for a second.", "Actually,
  can I change my order?") carry across *every* scenario and are the highest-ROI
  sentences a learner owns.

### 1.2 What the app already has

| Asset | Where | Relevance |
|---|---|---|
| Words bank (planned ~10k rows), server-side paged + facet counts | `app/core/src/db/words_query.rs`, schema `words` | The filter target. New dimensions must stay index-friendly SQL; no client-side scans of 10k rows. |
| Free-text `words.tags` (JSON array) + tag popover in the redesigned filter bar | `words.tags`, `db_list_word_tags`, `app/src/components/Vocabulary/filters/` | Proof that a multi-value classification filter works in this UI. Scenes are *not* tags (see §3.3). |
| Sentences bank with zh, notes, star; SRS via `srs_records(entity_type='sentence')` | `app/core/src/db/sentences.rs`, schema `sentences` | Scenario lines can be promoted here for spaced review instead of building a parallel SRS. |
| AI enrichment pipeline (2 calls/word: freeform explanation + structured basic-info JSON) | `app/src/providers/base.ts` (`BASIC_INFO_SYSTEM_PROMPT`), `app/src/lib/basicInfo.ts`, GUI bulk: `useVocabBulkEnrich.ts`, headless: `app/core/src/bin/enrich_all_words.rs` | The single highest-leverage coverage hook: adding scene classification to the basic-info call scene-tags **every future word for free**. |
| Dormant scene-lab: full schema (`scenes`, `scene_objects`, `scene_lessons`, `scene_vocabulary` → links `words.id`, sessions/attempts/examples/tasks/relations) + Rust commands `db_list_scenes`/`db_save_scene_lesson`/`db_get_scene_lesson` + TS `features/scene-lab/` (generation validation, learning machines) — **not wired to any nav page** | `app/core/src/db/scene_lab.rs`, `app/src/features/scene-lab/` | A *different* concept (3D kitchen object-labeling), but its code establishes reusable patterns: generation-key idempotency, lesson validation, attempt logging. Its name occupies "scene" in the codebase — see §3.1. `words.source='scene-lab'` and knowledge-map `kind='situation'` nodes are also free pre-existing scene signals. |
| Dual-backend schema discipline: `schema.sql` (SQLite) + `schema_postgres.sql`, fingerprint = sha256(schema file + mod.rs), idempotent re-run of the whole DDL batch when the fingerprint changes; `ensure_column` only for columns that batch indexes reference | `app/core/src/db/mod.rs` | New *tables* need no migration ALTERs: adding `CREATE TABLE IF NOT EXISTS` to both schema files changes the fingerprint automatically, and the next open re-runs the batch and creates them on live databases. |
| One shared Postgres across Windows/macOS/Ubuntu/web | — | Scenario content and word tags roam for free; schema lands once. |

### 1.3 The gap

1. Words have no scene dimension → cannot answer "show me my coffee-shop vocabulary".
2. No module exists to learn a scenario's dialogue space (question variants grouped
   by intent, prepared answers, repair lines) together with the learner's own words.

## 2. Goals & non-goals

**Goals**
- G1. Many-to-many scene tagging on words, with per-link *provenance* and *confidence*, filtering the Words list server-side at 10k scale.
- G2. A coverage engine that gets "most words tagged with most of their scenes" without manual labor (§6).
- G3. A new **Scenes** nav page: browse scenario packs (intent-grouped dialogue lines + linked bank words), generate packs with AI, listen via TTS.
- G4. Practice loop inside a scenario (v1 lean; stats v2).

**Non-goals (explicitly out of scope)**
- Modifying or deleting scene-lab tables/features. It stays dormant; a later consolidation decision is the user's.
- Vector/embedding similarity search. LLM batch classification is simpler, cheaper, and good enough.
- A new SRS algorithm. Scenario lines reuse the sentence bank's existing FSRS path by promotion (§5.3).
- Mobile-specific UX work; the page uses the ordinary responsive layout primitives.

## 3. Key decisions

### 3.1 Naming: `scenarios*` in code/SQL, "Scenes" in the UI

The identifier `scene` is already load-bearing in this codebase (`scenes`,
`scene_objects`, `scene_lessons`, `scene_vocabulary`…; `words.source='scene-lab'`).
Those tables carry 3D-asset semantics (`asset_path`, `generation_version`, lesson
lifecycle) that do not fit dialogue packs. Reusing them would couple a new feature
to a dormant experiment and make every future reader guess which "scene" is meant.

**Decision**: new tables named `scenarios`, `word_scenarios`, `scenario_lines`;
Rust module `db/scenarios.rs`; frontend `components/Scenes/` + `features/scenarios/`.
UI label is simply "Scenes". Code reviewers can never confuse the two systems.
Merging later (if scene-lab is revived or retired) is a deliberate rename, not an
untangling.

### 3.2 Many-to-many, with provenance on the join row

A word belongs to many scenes ("receipt": cafe, supermarket, returns). A single
`scene` column is therefore wrong. The join row carries:

- `source` — *why* the link exists (`manual`, `enrichment`, `backfill`, `jit`,
  `scenario-pack`, `scene-lab`, `knowledge-map`, `tag-import`). This is what makes
  coverage **measurable** ("how many words have zero links?") and **improvable in
  passes** (re-run the backfill only over untagged rows; trust `manual` over `ai`).
- `confidence` — REAL 0–1. Human and import links = 1.0; model assignments record
  their self-reported or policy-set value. The Words filter uses ALL links
  (precision damage is bounded by validation, §6.4); low-confidence links are what
  the review queue shows. Deleting a `manual` link is the only "veto" — the
  coverage engine never re-adds a source the user removed (`source` acts as the
  tombstone record).

### 3.3 Scenes are not tags

The zero-schema-change option (tags like `scene:cafe`) was considered and rejected:
tags are unqualified free text with no registry, no zh name, no icon, no ordering,
no pack content; the module needs a first-class registry either way. Tags stay for
*topical* categories; scenarios are *communicative situations*. The existing tags
ARE, however, a bootstrap source (§6.2).

### 3.4 Scenario lines live in their own table; promotion to the sentence bank is lazy and explicit

Scenario content has structure the flat `sentences` bank doesn't: intent groups,
roles (them/me), importance. Stuffing packs straight into `sentences` would flood
it with hundreds of variants. Instead, `scenario_lines` owns pack content; the
user can promote any line into the sentence bank (star → row in `sentences` with
`source='scenario'`, linked back via `scenario_lines.sentence_id`) where it picks
up the existing SRS/quiz machinery. Words need no such promotion — they live in
one global bank already; `word_scenarios` only links.

### 3.5 Precision over completeness, taxonomy grows from data

Never force a scene onto an unsure word: a wrong link erodes trust in the filter
and is invisible; a missing link is measurable and fixable by the next pass.
The seed taxonomy (§4.2) is deliberately incomplete — the backfill prompt has an
`unmatched` escape hatch, and recurring unmatched clusters become AI-*proposed*
scenarios (`origin='ai-proposed'`) the user approves in the UI. Coverage converges
from the data instead of guessing 200 scenes upfront.

## 4. Data model

### 4.1 Schema deltas (SQLite form shown; Postgres translation is mechanical)

Postgres rules, mirroring every existing table pair: `AUTOINCREMENT` →
`BIGINT GENERATED ALWAYS AS IDENTITY`, `INTEGER` → `BIGINT`, `REAL` →
`DOUBLE PRECISION`, `datetime('now')` → `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`.
Both files get identical logical DDL; indexes in the same batch.

```sql
-- Registry: one row per scenario. scenario_key is the STABLE external id
-- ('dining.cafe') used by prompts, filters, imports; integer id is internal only
-- (overwrite imports may renumber ids — never reference them in exports).
CREATE TABLE IF NOT EXISTS scenarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_key  TEXT NOT NULL UNIQUE,
  name_en       TEXT NOT NULL,
  name_zh       TEXT NOT NULL DEFAULT '',
  domain        TEXT NOT NULL DEFAULT '',  -- top-level grouping: 'dining', 'travel', ...
  icon          TEXT NOT NULL DEFAULT '',  -- lucide icon name, UI-side lookup
  description   TEXT NOT NULL DEFAULT '',
  origin        TEXT NOT NULL DEFAULT 'prebuilt'
                CHECK (origin IN ('prebuilt','ai-proposed','user')),
  archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Word ↔ scene membership. Composite PK gives the (word_id, scenario_id)
-- index for free; only the reverse direction needs an explicit one.
CREATE TABLE IF NOT EXISTS word_scenarios (
  word_id      INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  scenario_id  INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual','enrichment','backfill','jit',
                                 'scenario-pack','scene-lab','knowledge-map','tag-import')),
  confidence   REAL NOT NULL DEFAULT 1.0,
  created_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (word_id, scenario_id)
);
CREATE INDEX IF NOT EXISTS idx_word_scenarios_scenario
  ON word_scenarios(scenario_id, word_id);

-- Pack content: dialogue lines grouped by intent. Multi-line intents carry the
-- variant phrasings; role distinguishes what THEY say from what I say.
-- The cross-scenario repair toolkit is simply the seeded scenario
-- 'meta.repair' (§4.2), not a special role.
CREATE TABLE IF NOT EXISTS scenario_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id  INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  intent_key   TEXT NOT NULL DEFAULT '',   -- 'ask-size', 'pay', groups variants
  role         TEXT NOT NULL DEFAULT 'them' CHECK (role IN ('them','me')),
  text_en      TEXT NOT NULL,
  text_zh      TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',   -- register notes, why-this-answer
  importance   INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  sentence_id  INTEGER REFERENCES sentences(id) ON DELETE SET NULL,  -- lazy promotion (§3.4)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scenario_lines_scenario
  ON scenario_lines(scenario_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_scenario_lines_intent
  ON scenario_lines(scenario_id, intent_key);
```

Fingerprint note: no `ensure_column` entries are needed — these are new tables,
created by the re-run DDL batch itself. The `init_db_tests` pattern gets one new
regression test: a database built from the *pre-scene* schema must end up with
all three tables after `init_db` (mirrors `init_upgrades_a_pre_stickies_database_in_place`).

### 4.2 Seed taxonomy (checked in, not generated)

~50 scenarios across 10 domains, inserted idempotently on the fingerprint pass,
exactly like the calendar/settings seeding in `init_db_*`
(`INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`):

- **dining**: cafe, restaurant, fast-food, bar, bakery
- **travel**: airport, flight, hotel, customs, car-rental, asking-directions
- **transport**: rideshare-taxi, public-transit, gas-station, car-repair
- **shopping**: supermarket, clothing, pharmacy, returns-exchanges, farmers-market
- **services**: bank, post-office, haircut, phone-repair, dry-cleaning
- **health**: doctor, dentist, pharmacy-consult, emergency-room, vet
- **housing**: apartment-viewing, landlord-repairs, utilities-setup, moving
- **work**: job-interview, meetings, office-small-talk, phone-calls, presentations
- **social**: introductions, party, neighbors, invitations, giving-opinions
- **emergency**: police, lost-items, accidents-insurance
- **meta**: `meta.repair` — the cross-scenario repair toolkit ("could you say that
  again?", "what do you mean by…?", "let me think for a second"). The Scenes page
  renders its lines inside *every* scenario's practice view, per §1.1.

Keys are `domain.slug`. Names ship EN+ZH. `sort_order` = display order.
Seeding is append-only on the idempotent pass; user edits to names survive because
the seed uses `INSERT OR IGNORE`, never `UPDATE`.

## 5. Rust layer

New module `app/core/src/db/scenarios.rs` (registered in `db/mod.rs` like
`scene_lab`), all commands in the existing `#[crate::shim::command]` style:

- `db_list_scenarios()` → registry + per-scene stats in one query: word count
  (joined), line count, learned-bucket count. The gallery view's data.
- `db_get_scenario_detail(scenario_id)` → lines grouped by intent (ordered),
  plus the scenario row.
- `db_save_scenario_pack(input)` → upsert scenario row (by `scenario_key`) +
  replace-or-merge lines. **Idempotency cribbed from `db_save_scene_lesson`**:
  a `generation_key` (hash of scenario_key + prompt version + target levels)
  short-circuits duplicate saves; words matched into the bank by exact text get
  `word_scenarios(source='scenario-pack')` links in the same transaction.
- `db_set_word_scenarios(word_id, scenario_keys[])` → replace a word's manual
  set; incoming rows `source='manual', confidence=1.0`; existing non-manual rows
  untouched (manual edits never clobber AI evidence, and vice versa — the filter
  reads the union).
- `db_promote_scenario_line(line_id)` → insert into `sentences(source='scenario')`,
  seed its `srs_records` row, write the id back to `scenario_lines.sentence_id`.
- `db_propose_scenario(key/name_en/name_zh/domain)` → `origin='ai-proposed'`
  rows surface in Settings/gallery for one-click accept (flip `origin` to `'user'`
  is wrong — add a tiny `approved` handling via `archived=0` + origin change to `'user'`
  at accept time; details in implementation).

`words_query.rs` changes:

- `WordFilters` gains `scenarios: Vec<String>` (keys, not ids — see §4.1).
- `build_where` adds one portable arm (same param style as the tags arm):

  ```sql
  EXISTS (SELECT 1 FROM word_scenarios ws
          JOIN scenarios sc ON sc.id = ws.scenario_id
          WHERE ws.word_id = w.id AND sc.scenario_key IN (?N...))
  ```

  `EXISTS` + the `(scenario_id, word_id)` index keeps the page query sub-ms at
  10k words on both backends; multiple selected scenes OR together, matching the
  tags axis's semantics. `FacetSkip` gains no variant in v1 (per-scene facet
  counts are skip-free globals, mirroring `db_list_word_tags`).
- `db_list_word_scenario_counts()` → `SELECT sc.scenario_key, sc.name_en,
  COUNT(ws.word_id) FROM scenarios sc LEFT JOIN word_scenarios ws … GROUP BY …`
  — relational, indexed, portable (unlike tags, no JSON folding needed). Drives
  the filter popover AND the gallery cards.

## 6. Coverage engine — "how most words get most of their scenes"

This is the heart of the plan. Five sources, cheapest first; only #4 spends
meaningful tokens.

### 6.1 Invariants

- Every link records `source` + `confidence` (§3.2).
- Unknown scenario keys from any AI output are dropped at parse time, never
  stored; the registry is the single answer key.
- Re-runs are safe: every pass is `INSERT OR IGNORE`-style on the PK.
- Nothing overwrites or resurrects a link the user deleted (§3.2 tombstone rule).

### 6.2 Source 1 — derive from existing data (zero AI calls)

One-time pass (idempotent, re-runnable):

- scene-vocabulary links: `scene_vocabulary.word_id × owning scene` →
  `word_scenarios(source='scene-lab', 1.0)` where a taxonomy scene matches the
  scene-lab scene name mapping table (checked in, tiny).
- knowledge maps: `knowledge_nodes.kind='situation'` nodes → their `word_id`
  children inherit the situation's mapped scenario (`source='knowledge-map', 0.95`).
- tags: `words.tags` entries that exactly match a scenario key/name →
  `source='tag-import', 0.9`.

### 6.3 Source 2 — fold scenes into the enrichment call (zero marginal cost, forever)

The enrichment pipeline already makes a **structured basic-info JSON call per
word** (`BASIC_INFO_SYSTEM_PROMPT` in `app/src/providers/base.ts:151`, with its
verbatim mirror in `enrich_all_words.rs`). Extend that single JSON contract:

```json
{"word_type":"n","level":"B1","zh":"收据","scenes":["dining.cafe","shopping.supermarket"]}
```

- Prompt change: append the taxonomy as a numbered answer key (key — EN name —
  one-line gloss), instruct "0–3 scenes, only when clearly applicable; omit the
  field when none fit" (precision-first: an absent field is a valid answer).
- Parser change: `basicInfo.ts` validates keys against the registry (fetched once
  per session from `db_list_scenarios`, cached in a small zustand store), drops
  unknowns, caps at 3.
- Write change: `db_add_word_enriched` gains a `scenes` param; inside its existing
  transaction it inserts `word_scenarios(source='enrichment', confidence=0.85)`.
- **Callers that flow through automatically**: single-word enrich, selected-word
  enrich, GUI bulk enrich (`useVocabBulkEnrich.ts`), headless injection, and the
  headless binary. From ship day, every new or re-enriched word arrives tagged.
- Maintenance hazard to guard: `enrich_all_words.rs` holds a *verbatim copy* of the
  prompts (file header says so). The two copies must be edited in lockstep — the
  plan adds a comment-pointer in both directions and the binary gains `scenes`
  parsing via the same brace-scan rules it already uses.

### 6.4 Source 3 — one bulk backfill over the existing bank (paid, once)

For the backlog, a sibling binary `classify_word_scenarios.rs`, deliberately
shaped like `enrich_all_words.rs` (owns its concurrency/retries/progress;
headless `nohup`-friendly; resumable by construction):

- **Selection**: words with zero `word_scenarios` rows, batched 40/call.
  Resumable = re-running simply re-selects the same predicate.
- **Prompt**: system = full taxonomy answer key (same block as §6.3, shared
  constant); user = JSON array `[{"w":"bank","pos":"n","zh":"银行"},…]` — POS+zh
  disambiguate polysemy (bank → finance, not river). Response:
  `{"results":[{"w":"bank","scenes":["services.bank"],"confidence":0.9}],
   "unmatched":[{"w":"…","suggests":"video-call"}]}`.
- **Write**: `source='backfill'`, confidence from the model clamped 0.5–0.95.
- **`unmatched` aggregation**: recurring `suggests` strings (count ≥ 10) become
  `db_propose_scenario` candidates — taxonomy growth from data (§3.5).
- **Cost floor**: 10k words ÷ 40 ≈ 250 calls on the cheapest configured model.
- Verify the count query + write path against BOTH backends before the real run
  (the `?N` placeholder translator quirk is the known risk — same style as the
  tags arm, which works, but scenes arm adds a join inside `EXISTS`).

### 6.5 Source 4 — reverse-direction JIT (when a scene is actually opened)

On first opening a scenario with thin coverage: "Find my words that fit this
scene" → one call with the scenario description + the user's *untagged* word list
(paged, ~200/call) asks "which belong?" → `source='jit', 0.8`. Humans tag
scene→words; models are better at words→scene, and we only pay for scenes the
user actually studies.

### 6.6 Source 5 — human review, sized small

- Words list gains batch scene assignment in select mode (the UI already has
  select-mode batch status/delete; same slot).
- Word detail panel shows scene chips; add/remove calls `db_set_word_scenarios`.
- A review queue view (inside the Scenes page, not the Words page): links with
  `confidence < 0.7` and `source != 'manual'`, accept/reject. Reject = delete row
  (`source` tombstone rule keeps it gone).
- Adding a word from *inside* a scenario view auto-links it
  (`source='scenario-pack'` if pack-created, else `manual`).

### 6.7 Coverage metrics

`db_list_scenarios` already returns per-scene word counts; add one global number
to the same payload: `untagged_words` (words with zero links). The gallery header
shows it; every pass's goal is monotonic decrease without precision regressions
(spot-check 20 random new links after each backfill run).

## 7. Words module changes

- **Filter bar**: scene multi-select popover attached to `MoreControl` (same
  component family as the tags popover), fed by `db_list_word_scenario_counts`;
  selected scenes render as `FilterToken`s with a MapPin icon; `tier2Count`
  includes the scene axis.
- **Persisted filters**: bump `WORD_FILTER_STORAGE_KEY` to
  `vocab-words-filters-v2`, adding `scenes: string[]`. Sanitizer: free-string
  cleaning like tags (a stale key in storage just matches nothing and shows as a
  removable token — same failure mode philosophy as a stale tag; stricter
  registry validation happens implicitly because the popover only offers known
  keys). `wordFilterDefs.test.ts` gains v2 cases.
- **Plumbing**: `useDB.types.ts` (`WordListItem` unchanged — scenes are NOT
  joined into every list row; the list only filters), `useDB.core.ts`
  `getWordsPage` passthrough param, `useVocabWordList.ts` wires load/persist.
- **Word detail**: scenes chips row + editor popover → `db_set_word_scenarios`.
- No sort changes, no `WordFilterFacets` changes in v1.

## 8. Scenes module (new nav page)

### 8.1 Registration (all the places a page must be added)

- `store/navStore.ts`: `"scenes"` into the `NavPage` union + `HASHABLE_PAGES`.
- `pages/pageCatalog.tsx`: one `PageDefinition` (`titleKey: "nav.scenes"`,
  MapPin-style icon, `host: "react"`, `multiplicity: "singleton"`, default
  minimums) — catalog tests updated.
- i18n: `nav.scenes` + a new `scenes.*` namespace in `app/src/i18n/en/` and
  `…/zh/` (mirroring the vocabulary.ts structure).
- Component root: `components/Scenes/ScenesPage.tsx` (lazy `load` in catalog).

### 8.2 UX structure

- **Gallery**: scenario cards grouped by domain (name EN+ZH, icon, my-word count,
  line count, progress). Header: untagged-words counter + review-queue entry.
  Sort: user's unmastered-word density first (study ROI), then `sort_order`.
- **Scenario detail**, three tabs:
  - *Prep*: intents as cards — each shows all THEM variants (listen button per
    line, tap-to-reveal ZH) and MY answers; repair-toolkit section appended from
    `meta.repair`.
  - *Words*: my bank words linked to this scene, with status dots; "add words"
    (searches bank, links, `source='manual'`); "suggest more" (§6.5).
  - *Practice* (v1 lean): flash loop — hear/read a THEM line → speak → reveal a
    model answer → self-grade. Grading only flips local/UI state in v1.
- **Pack authoring**: "New scene" (user key/name) or any existing-but-empty
  scenario → **Generate with AI**: one structured call producing intents +
  variants + answers + suggested words → `validateScenarioPack.ts` (mirror
  `features/scene-lab/generation/validateLesson.ts` discipline: schema-check,
  clamp, drop junk) → `db_save_scenario_pack` (generation_key idempotent) →
  suggested words exact-matched against the bank: existing words get links,
  absent words are offered as "add N words to bank" (`words.source='scenario'`,
  added to `WORD_SOURCE_VALUES` + i18n).

### 8.3 v2 reserves (schema NOT built now, documented so v1 doesn't paint corners)

- `scenario_attempts` (mirror scene_attempts) once practice grading should
  persist and drive "weakest intents first" practice ordering.
- Per-scene facet counts in the words filter popover (respecting other filters).
- Knowledge-map visualization of scenario ↔ intents ↔ words.

## 9. Import/export compatibility (must-verify list)

- `db/import/overwrite/copy.rs` discovers tables dynamically (`list_real_tables`)
  but carries **explicit per-table column lists** (see the `enrichment_json`
  column-order comment). Action: register the three new tables there, with the
  FK-safe topological order relying on existing topo sort. Overwrite import then
  carries scenarios/lines/memberships.
- **Merge import can't survive integer ids** (the file header says exactly this
  about scene-lab rows). Merge strategy: scenarios merge by `scenario_key`;
  `scenario_lines` merge by `(scenario_key, text_en)` dedup; `word_scenarios`
  re-link by *word text* + `scenario_key` after word merge; `sentence_id`
  back-references re-resolve by sentence text. Implement in the same pass as the
  overwrite registration (P4) — until then, merge import documents the new tables
  as skipped, never silently dropped.
- `deploy/` backup path: verify remote backup covers the new tables (it reads
  the same dynamic table list — confirm, don't assume).

## 10. Testing

**Rust (`app/core`)**
- `init_db` regression: pre-scene database gains all three tables + indexes +
  seed taxonomy after the fingerprint pass (both backends where harness allows).
- `words_query` build_where: scene arm SQL + param numbering with every other
  filter axis active; EXISTS semantics (ANY-match).
- `db_save_scenario_pack` roundtrip: idempotency on generation_key; links
  created; zh/lower-casing rules; transaction rollback on invalid input.
- `db_set_word_scenarios` union semantics: manual replace never touches
  non-manual rows; tombstone respected on re-run sources.
- Extend `tests/seaorm_command_smoke.rs` for the new commands (same pattern as
  the scene-lab entries).
- `cargo test` full pass; `sqlite` and, where available, `postgres` feature runs.

**Frontend (`app/src`)**
- `wordFilterDefs.test.ts`: v2 load/save/sanitize (unknown scene keys kept as
  clean strings; cap; dedupe).
- `validateScenarioPack.test.ts`: junk-drop and clamp rules (mirror
  `validateLesson.test.ts`).
- `pageCatalog.test.ts` + navStore hash tests for the new page.
- `vitest` full pass; `tsc` clean.

**Manual verification matrix**
- Fresh SQLite profile; upgraded live SQLite profile (tables appear, data intact).
- Shared Postgres profile: tables created once, visible from a second device.
- Backfill dry-run (`--limit 40`) then real run; coverage counters move; 20-link
  spot-check.
- Web build (`dsh web`-style host) still boots; page reachable on web.

## 11. Rollout phases

| Phase | Contents | Exit signal |
|---|---|---|
| **P0** | Schema (both files) + seed taxonomy + init regression test | `cargo test` green; live DBs gain tables on open |
| **P1** | Rust scenario CRUD + words filter scene arm + counts query; filter bar popover + tokens + persisted v2; word-detail chips editor | Filter by `dining.cafe` works on a seeded+hand-tagged dataset at 10k scale |
| **P2** | Enrichment fold-in (prompt/parsers/write path, both prompt copies) + `classify_word_scenarios.rs` backfill + source-1 derivations | Backfill completes; coverage counters show ≥90% of enriched words with ≥1 link; spot-check ≥18/20 correct |
| **P3** | Scenes page: gallery, detail Prep/Words tabs, TTS wiring, AI pack generation + validation + save | Generate "dining.cafe" pack, listen through a full prep pass on two platforms |
| **P4** | Practice tab + self-grade UI; review queue; JIT suggest; import/export registration incl. merge re-linking | Full loop: generate → prep → practice → tagged words visible in Words filter |

Phases are individually shippable; P0+P1 alone already deliver "filter words by
scene".

## 12. Risks & open questions

1. **Postgres SQL rewriter**: `EXISTS … IN (?N…)` inside the page WHERE — same
   construct family as tags but with a join. Mitigate in P1 with a smoke test on
   a real PG profile before any UI work depends on it.
2. **Column lists in overwrite copy** (§9) — verified in P4; until then exports
   omit the new tables (safe failure: data re-derivable via bank words + packs).
3. **Prompt drift between the two BASIC_INFO copies** (§6.3) — pointer comments
   both ways; a long-term constant-share is noted as future cleanup, not bundled.
4. **Taxonomy language**: keys/en names English; `name_zh` required for seeds.
   User-creatable scenarios get both fields, EN mandatory (key derivation).
5. **Enrichment reschooling**: existing enriched words won't get scenes until
   backfill (P2) — accepted; re-enriching 10k words just for scenes is wasted
   tokens when the classifier call is 10× cheaper.
6. **Open**: default practice-loop grading persistence (v2 `scenario_attempts`?
   or reuse `quiz_answers` with `entity_type='scenario_line'`?). Decided when P4
   starts — v1 works without it.

## 13. What this plan deliberately avoids

- No embeddings/vector store.
- No changes to scene-lab; no shared tables with it.
- No forced tagging to reach a coverage number; the escape hatch (`unmatched`)
  and thresholds keep precision high and let the taxonomy grow honestly.
- No commits without an explicit user request; work lands in the working tree
  for review first.
