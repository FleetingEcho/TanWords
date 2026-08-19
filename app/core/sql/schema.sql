-- ═══════════════════════════════════════════════════════════════════════════
-- TanWords — SQLite schema (fresh-install, no migration history)
-- ═══════════════════════════════════════════════════════════════════════════
-- This file is the single source of truth for the SQLite schema. init_db runs
-- it as one execute_batch on a fresh database, then stamps a fingerprint so a
-- subsequent launch skips the pass. There is no incremental migration history
-- — old databases are not supported (breaking change).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Words & vocabulary
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS words (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  word            TEXT NOT NULL UNIQUE,
  word_type       TEXT,
  level           TEXT,
  word_freq       INTEGER DEFAULT 1,
  mnemonic        TEXT,
  notes           TEXT,
  user_notes      TEXT DEFAULT '',
  source          TEXT DEFAULT 'manual',
  enrichment_json TEXT,
  enrichment_text TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'learning',
  starred         INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_words_source ON words(source);
CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);

CREATE TABLE IF NOT EXISTS word_definitions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  pos           TEXT NOT NULL,
  zh            TEXT NOT NULL,
  en            TEXT,
  example_en    TEXT,
  example_zh    TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_word_definitions_word_id ON word_definitions(word_id);

CREATE TABLE IF NOT EXISTS word_phonetics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id      INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  locale       TEXT NOT NULL,
  ipa          TEXT NOT NULL,
  audio_url    TEXT,
  accent_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_word_phonetics_word_id ON word_phonetics(word_id);

CREATE TABLE IF NOT EXISTS word_etymology (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  parts         TEXT,
  story         TEXT,
  origin_lang   TEXT,
  first_use_era TEXT
);

CREATE TABLE IF NOT EXISTS word_relations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_word_id  INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  to_word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  weight        REAL DEFAULT 1.0,
  note          TEXT,
  is_bidirect   INTEGER DEFAULT 0,
  source        TEXT DEFAULT 'ai',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(from_word_id, to_word_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_word_relations_from ON word_relations(from_word_id);
CREATE INDEX IF NOT EXISTS idx_word_relations_to ON word_relations(to_word_id);

CREATE TABLE IF NOT EXISTS word_chats (
  word_id    INTEGER PRIMARY KEY,
  messages   TEXT NOT NULL DEFAULT '[]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(word_id) REFERENCES words(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Sentences — first-class saved sentences (replaces patterns system)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sentences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence    TEXT NOT NULL,
  zh          TEXT NOT NULL DEFAULT '',
  level       TEXT,
  note        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  starred     INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sentences_created ON sentences(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SRS / Quiz
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS srs_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id        INTEGER NOT NULL,
  entity_type      TEXT NOT NULL,
  srs_level        INTEGER DEFAULT 0,
  srs_ease         REAL DEFAULT 2.5,
  review_count     INTEGER DEFAULT 0,
  last_reviewed_at DATETIME,
  next_review_at   DATETIME,
  stability        REAL NOT NULL DEFAULT 0,
  difficulty       REAL NOT NULL DEFAULT 0,
  elapsed_days     INTEGER NOT NULL DEFAULT 0,
  scheduled_days   INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  state            INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entity_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_srs_records_next_review ON srs_records(next_review_at);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  total        INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  duration_sec INTEGER,
  quiz_type    TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  entity_id   INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  is_correct  INTEGER NOT NULL,
  user_answer TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Translations & streaks & settings
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS translations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_text TEXT NOT NULL,
  result_text TEXT NOT NULL,
  source_lang TEXT DEFAULT 'auto',
  target_lang TEXT NOT NULL,
  provider    TEXT NOT NULL,
  mode        TEXT DEFAULT 'translate',
  context     TEXT,
  cluster_tag TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_translations_created ON translations(created_at);

CREATE TABLE IF NOT EXISTS db_imports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL,
  file_size       INTEGER,
  total_words     INTEGER DEFAULT 0,
  total_sentences INTEGER DEFAULT 0,
  new_words       INTEGER DEFAULT 0,
  merged_words    INTEGER DEFAULT 0,
  conflict_words  INTEGER DEFAULT 0,
  new_sentences   INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_streaks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL UNIQUE,
  words_added     INTEGER DEFAULT 0,
  sentences_added INTEGER DEFAULT 0,
  quiz_done       INTEGER DEFAULT 0,
  translations    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_date ON daily_streaks(date);

CREATE TABLE IF NOT EXISTS user_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_providers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  api_base   TEXT NOT NULL,
  api_key    TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  is_active  INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Documents & assets
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL DEFAULT 'Untitled',
  content         TEXT    NOT NULL DEFAULT '{}',
  content_text    TEXT    NOT NULL DEFAULT '',
  tags            TEXT    NOT NULL DEFAULT '[]',
  pinned          INTEGER NOT NULL DEFAULT 0,
  word_count      INTEGER NOT NULL DEFAULT 0,
  protected       INTEGER NOT NULL DEFAULT 0,
  protection_salt BLOB,
  wrapped_key     BLOB,
  folder          TEXT    NOT NULL DEFAULT '',
  task_total      INTEGER NOT NULL DEFAULT 0,
  task_done       INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  content_text,
  content='documents',
  content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, content_text)
  VALUES (new.id, new.title, new.content_text);
END;
CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
  VALUES ('delete', old.id, old.title, old.content_text);
END;
-- Metadata-only writes must not make FTS5 delete and rebuild a large body.
-- Only title/content_text changes fire the update trigger (migration 33).
CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE OF title, content_text ON documents
WHEN old.title IS NOT new.title OR old.content_text IS NOT new.content_text
BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content_text)
  VALUES ('delete', old.id, old.title, old.content_text);
  INSERT INTO documents_fts(rowid, title, content_text)
  VALUES (new.id, new.title, new.content_text);
END;

CREATE TABLE IF NOT EXISTS document_assets (
  id          TEXT PRIMARY KEY,
  document_id INTEGER NOT NULL,
  file_name   TEXT NOT NULL DEFAULT 'image',
  mime_type   TEXT NOT NULL,
  data        BLOB NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_document_assets_document ON document_assets(document_id);

CREATE TABLE IF NOT EXISTS standalone_assets (
  id         TEXT PRIMARY KEY,
  file_name  TEXT NOT NULL DEFAULT 'file',
  mime_type  TEXT NOT NULL,
  data       BLOB NOT NULL,
  size       INTEGER NOT NULL,
  remote_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS all_document_assets AS
  SELECT id, document_id, file_name, mime_type, data, size, created_at, 0 AS standalone
    FROM document_assets
  UNION ALL
  SELECT id, 0 AS document_id, file_name, mime_type, data, size, created_at, 1 AS standalone
    FROM standalone_assets;

CREATE TABLE IF NOT EXISTS r2_config (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  config_enc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_folders (
  path       TEXT PRIMARY KEY,
  locked      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. AI Chat
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id            TEXT PRIMARY KEY,
  title         TEXT    NOT NULL DEFAULT 'New Chat',
  messages      TEXT    NOT NULL DEFAULT '[]',
  system_prompt TEXT    NOT NULL DEFAULT '',
  preset_id     TEXT    NOT NULL DEFAULT 'english-tutor',
  provider_id   TEXT    NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Reading articles
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS articles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL DEFAULT '',
  source_url       TEXT NOT NULL DEFAULT '',
  origin           TEXT NOT NULL DEFAULT 'pasted',
  content          TEXT NOT NULL DEFAULT '',
  analysis_markdown TEXT NOT NULL DEFAULT '',
  hn_item_id       INTEGER,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_known_words (
  word       TEXT PRIMARY KEY,
  source     TEXT NOT NULL DEFAULT 'marked',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reading_articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  word_count   INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'paste',
  source_url   TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reading_articles_read ON reading_articles(last_read_at DESC);

CREATE TABLE IF NOT EXISTS reading_article_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id  INTEGER NOT NULL REFERENCES reading_articles(id) ON DELETE CASCADE,
  author      TEXT NOT NULL DEFAULT 'ai',
  body        TEXT NOT NULL DEFAULT '',
  anchor_text TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reading_comments_article ON reading_article_comments(article_id);

CREATE VIRTUAL TABLE IF NOT EXISTS reading_articles_fts USING fts5(
  title, content, content='reading_articles', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS reading_articles_ai AFTER INSERT ON reading_articles BEGIN
  INSERT INTO reading_articles_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS reading_articles_ad AFTER DELETE ON reading_articles BEGIN
  INSERT INTO reading_articles_fts(reading_articles_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS reading_articles_au AFTER UPDATE ON reading_articles BEGIN
  INSERT INTO reading_articles_fts(reading_articles_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO reading_articles_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Calendar
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_calendars (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color_name TEXT NOT NULL DEFAULT 'blue',
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id           TEXT PRIMARY KEY,
  calendar_id  TEXT NOT NULL DEFAULT 'default',
  title        TEXT NOT NULL DEFAULT '',
  start         TEXT NOT NULL,
  "end"        TEXT NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0,
  color_name   TEXT,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(calendar_id) REFERENCES calendar_calendars(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. RSS feeds & entries & bookmarks
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rss_feeds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL DEFAULT '',
  url               TEXT NOT NULL,
  site_link         TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  last_fetched_at   TEXT,
  category_override TEXT CHECK(category_override IN ('article', 'podcast')),
  is_pinned         INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0, 1)),
  pin_order         INTEGER,
  is_paused         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feeds_url ON rss_feeds(url);

CREATE TABLE IF NOT EXISTS rss_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id        INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL UNIQUE,
  author         TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  image_url      TEXT,
  published      TEXT NOT NULL DEFAULT '',
  is_read        INTEGER NOT NULL DEFAULT 0,
  audio_url      TEXT,
  audio_duration INTEGER,
  hn_item_id     INTEGER,
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rss_entries_feed ON rss_entries(feed_id, published DESC);

CREATE TABLE IF NOT EXISTS feed_bookmarks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  url            TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL DEFAULT '',
  feed_title     TEXT NOT NULL DEFAULT '',
  domain         TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  image_url       TEXT,
  audio_url      TEXT,
  audio_duration INTEGER,
  hn_item_id     INTEGER,
  published      TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feed_bookmarks_created ON feed_bookmarks(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Search history
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS search_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT NOT NULL,
  searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history(searched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_history_word ON search_history(word);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. AI providers (device-scoped, encrypted keys)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_providers (
  device_id   TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'custom',
  api_base    TEXT NOT NULL DEFAULT '',
  model_id    TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, id)
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_device ON ai_providers(device_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Scene Lab
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scenes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_key         TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  scene_type        TEXT NOT NULL DEFAULT 'prebuilt',
  asset_path        TEXT NOT NULL DEFAULT '',
  generation_version INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scene_objects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id      INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  object_key    TEXT NOT NULL,
  label         TEXT NOT NULL,
  position_json TEXT NOT NULL DEFAULT '[0,0,0]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(scene_id, object_key)
);

CREATE TABLE IF NOT EXISTS scene_lessons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id       INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  target_levels  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('generating','ready','failed','archived')),
  prompt_version INTEGER NOT NULL DEFAULT 1,
  generation_key TEXT NOT NULL UNIQUE,
  generated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scene_lessons_scene ON scene_lessons(scene_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS scene_vocabulary (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id       INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
  object_id       INTEGER NOT NULL REFERENCES scene_objects(id) ON DELETE CASCADE,
  word_id         INTEGER REFERENCES words(id) ON DELETE SET NULL,
  word            TEXT NOT NULL,
  zh              TEXT NOT NULL DEFAULT '',
  ipa             TEXT NOT NULL DEFAULT '',
  level           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  importance      INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  learning_status TEXT NOT NULL DEFAULT 'new' CHECK(learning_status IN ('new','learning','familiar','mastered')),
  UNIQUE(lesson_id, word)
);
CREATE INDEX IF NOT EXISTS idx_scene_vocab_lesson_object ON scene_vocabulary(lesson_id, object_id);
CREATE INDEX IF NOT EXISTS idx_scene_vocab_word ON scene_vocabulary(word_id);

CREATE TABLE IF NOT EXISTS scene_examples (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_vocabulary_id INTEGER NOT NULL REFERENCES scene_vocabulary(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK(kind IN ('collocation','action','sentence')),
  content_en          TEXT NOT NULL,
  content_zh          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scene_relations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  relation   TEXT NOT NULL CHECK(relation IN ('located_near','used_for','followed_by','belongs_to')),
  target_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scene_tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
  title_en   TEXT NOT NULL,
  title_zh   TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scene_tasks_lesson ON scene_tasks(lesson_id, sort_order);

CREATE TABLE IF NOT EXISTS scene_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   INTEGER NOT NULL REFERENCES scene_lessons(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK(mode IN ('explore','semantic','task','test')),
  started_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_scene_sessions_lesson ON scene_sessions(lesson_id, started_at DESC);

CREATE TABLE IF NOT EXISTS scene_attempts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         INTEGER NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
  scene_vocabulary_id INTEGER NOT NULL REFERENCES scene_vocabulary(id) ON DELETE CASCADE,
  mode               TEXT NOT NULL CHECK(mode IN ('explore','semantic','task','test')),
  correct            INTEGER NOT NULL CHECK(correct IN (0,1)),
  response_ms        INTEGER NOT NULL DEFAULT 0,
  hints_used         INTEGER NOT NULL DEFAULT 0,
  attempted_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scene_attempts_session ON scene_attempts(session_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_scene_attempts_vocab ON scene_attempts(scene_vocabulary_id, attempted_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Knowledge maps
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_maps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  root_label    TEXT NOT NULL,
  root_type     TEXT NOT NULL DEFAULT 'topic',
  target_levels TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id     INTEGER NOT NULL REFERENCES knowledge_maps(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK(kind IN ('topic','category','word','phrase','situation','contrast')),
  label      TEXT NOT NULL,
  zh         TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  depth      INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  expanded   INTEGER NOT NULL DEFAULT 0 CHECK(expanded IN (0,1)),
  word_id    INTEGER REFERENCES words(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(map_id, parent_id, label)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_map_parent ON knowledge_nodes(map_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_word ON knowledge_nodes(word_id);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id     INTEGER NOT NULL REFERENCES knowledge_maps(id) ON DELETE CASCADE,
  source_id  INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL DEFAULT 'contains',
  UNIQUE(map_id, source_id, target_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_map ON knowledge_edges(map_id, source_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. Writing Studio
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS writing_submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  original_text      TEXT NOT NULL,
  input_type         TEXT NOT NULL CHECK(input_type IN ('sentence','essay')),
  detected_genre     TEXT NOT NULL DEFAULT '',
  overall_feedback   TEXT NOT NULL DEFAULT '',
  refined_full_text  TEXT NOT NULL DEFAULT '',
  structure_feedback TEXT NOT NULL DEFAULT '',
  coherence_feedback TEXT NOT NULL DEFAULT '',
  tone_feedback      TEXT NOT NULL DEFAULT '',
  sentence_count     INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_writing_submissions_created ON writing_submissions(created_at DESC);

CREATE TABLE IF NOT EXISTS writing_sentences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  original      TEXT NOT NULL,
  corrected     TEXT NOT NULL DEFAULT '',
  natural       TEXT NOT NULL DEFAULT '',
  explanation   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_writing_sentences_submission ON writing_sentences(submission_id, position);

CREATE TABLE IF NOT EXISTS writing_vocabulary (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id         INTEGER NOT NULL REFERENCES writing_sentences(id) ON DELETE CASCADE,
  original_expression TEXT NOT NULL DEFAULT '',
  suggested_word      TEXT NOT NULL,
  meaning             TEXT NOT NULL DEFAULT '',
  reason              TEXT NOT NULL DEFAULT '',
  example_sentence    TEXT NOT NULL DEFAULT '',
  selected            INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
  vocabulary_id       INTEGER REFERENCES words(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_vocabulary_sentence ON writing_vocabulary(sentence_id);

CREATE TABLE IF NOT EXISTS writing_model_essays (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS writing_summaries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  source_type    TEXT NOT NULL CHECK(source_type IN ('sentences','submissions','summaries')),
  source_snapshot TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_writing_summaries_created ON writing_summaries(created_at DESC);
