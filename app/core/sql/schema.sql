-- ═══════════════════════════════════════
-- TanWords 完整数据库 Schema
-- ═══════════════════════════════════════

-- 1. 词汇表
CREATE TABLE IF NOT EXISTS words (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word          TEXT NOT NULL UNIQUE,
  word_type     TEXT,
  level         TEXT,
  word_freq     INTEGER DEFAULT 1,
  mnemonic      TEXT,
  notes         TEXT,
  user_notes    TEXT DEFAULT '',
  source        TEXT DEFAULT 'manual',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 词义表
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

-- 3. 音标表
CREATE TABLE IF NOT EXISTS word_phonetics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  locale        TEXT NOT NULL,
  ipa           TEXT NOT NULL,
  audio_url     TEXT,
  accent_label  TEXT
);

-- 4. 词源表
CREATE TABLE IF NOT EXISTS word_etymology (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  parts         TEXT,
  story         TEXT,
  origin_lang   TEXT,
  first_use_era TEXT
);

-- 5. 词汇关系表（图的边）
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

-- 6. 句子表
CREATE TABLE IF NOT EXISTS sentences (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  text             TEXT NOT NULL,
  translation      TEXT,
  source_name      TEXT,
  source_type      TEXT,
  grammar_analysis TEXT,
  difficulty       TEXT,
  notes            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. 句子-词关联表
CREATE TABLE IF NOT EXISTS sentence_words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  position    INTEGER,
  is_key      INTEGER DEFAULT 0,
  UNIQUE(sentence_id, word_id)
);

-- 8. 标签定义表
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  tag_type   TEXT DEFAULT 'user'
);

-- 9. 实体标签关联表
CREATE TABLE IF NOT EXISTS entity_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_id   INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  UNIQUE(tag_id, entity_id, entity_type)
);

-- 10. 引言表
CREATE TABLE IF NOT EXISTS quotes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  source_name TEXT,
  source_type TEXT,
  word_id     INTEGER REFERENCES words(id) ON DELETE SET NULL,
  sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. SRS 记录表
CREATE TABLE IF NOT EXISTS srs_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id       INTEGER NOT NULL,
  entity_type     TEXT NOT NULL,
  srs_level       INTEGER DEFAULT 0,
  srs_ease        REAL DEFAULT 2.5,
  review_count    INTEGER DEFAULT 0,
  last_reviewed_at DATETIME,
  next_review_at  DATETIME,
  UNIQUE(entity_id, entity_type)
);

-- 12. 测验会话表
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  total        INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  duration_sec INTEGER,
  quiz_type    TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. 答题记录表
CREATE TABLE IF NOT EXISTS quiz_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  entity_id   INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  is_correct  INTEGER NOT NULL,
  user_answer TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. 翻译历史表
CREATE TABLE IF NOT EXISTS translations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_text  TEXT NOT NULL,
  result_text  TEXT NOT NULL,
  source_lang  TEXT DEFAULT 'auto',
  target_lang  TEXT NOT NULL,
  provider     TEXT NOT NULL,
  mode         TEXT DEFAULT 'translate',
  context      TEXT,
  cluster_tag  TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 15. DB 导入历史表
CREATE TABLE IF NOT EXISTS db_imports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path        TEXT NOT NULL,
  file_size        INTEGER,
  total_words      INTEGER DEFAULT 0,
  total_sentences  INTEGER DEFAULT 0,
  new_words        INTEGER DEFAULT 0,
  merged_words     INTEGER DEFAULT 0,
  conflict_words   INTEGER DEFAULT 0,
  new_sentences    INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'pending',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 16. 每日打卡表
CREATE TABLE IF NOT EXISTS daily_streaks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL UNIQUE,
  words_added     INTEGER DEFAULT 0,
  sentences_added INTEGER DEFAULT 0,
  quiz_done       INTEGER DEFAULT 0,
  translations    INTEGER DEFAULT 0
);

-- 17. 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 18. 自定义 AI 提供商表
CREATE TABLE IF NOT EXISTS custom_providers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  api_base     TEXT NOT NULL,
  api_key      TEXT NOT NULL,     -- API Key（明文存储，后续可加 AES-256 加密）
  model_id     TEXT NOT NULL,
  is_active    INTEGER DEFAULT 1,
  sort_order   INTEGER DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_word_definitions_word_id ON word_definitions(word_id);
CREATE INDEX IF NOT EXISTS idx_word_phonetics_word_id ON word_phonetics(word_id);
CREATE INDEX IF NOT EXISTS idx_word_relations_from ON word_relations(from_word_id);
CREATE INDEX IF NOT EXISTS idx_word_relations_to ON word_relations(to_word_id);
CREATE INDEX IF NOT EXISTS idx_srs_records_next_review ON srs_records(next_review_at);
CREATE INDEX IF NOT EXISTS idx_translations_created ON translations(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_date ON daily_streaks(date);
CREATE INDEX IF NOT EXISTS idx_sentence_words_sentence ON sentence_words(sentence_id);
CREATE INDEX IF NOT EXISTS idx_sentence_words_word ON sentence_words(word_id);
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_id, entity_type);
