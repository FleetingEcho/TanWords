/** Shared type definitions for the useDB hook family (useDB.core.ts / useDB.extra.ts). */

export interface ChatSessionItem {
  id: string;
  title: string;
  preset_id: string;
  provider_id: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  content_text: string;
  /** Folded out of the main list into the archive section. */
  archived: boolean;
  /** Sorts above the rest of its shelf. */
  pinned: boolean;
}

export interface ChatSessionDetail extends ChatSessionItem {
  messages: string;       // JSON string
  system_prompt: string;
}

export interface WordListItem {
  id: number;
  word: string;
  word_type: string | null;
  level: string | null;
  word_freq: number;
  zh: string | null;
  srs_level: number;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
  source: string;
  /** Whether this word already has an AI-generated enrichment. */
  enriched: boolean;
  starred: boolean;
}

export interface WordDetail {
  id: number;
  word: string;
  word_type: string | null;
  level: string | null;
  word_freq: number;
  mnemonic: string | null;
  notes: string | null;
  source: string;
  srs_level: number;
  next_review_at: string | null;
  created_at: string;
  definitions: {
    pos: string;
    zh: string;
    en: string | null;
    example_en: string | null;
    example_zh: string | null;
  }[];
  /** Freeform AI-generated markdown explanation. */
  enrichment_text?: string | null;
  /** Structured enrichment from before the freeform-text rewrite — only
   * present to let the UI offer "legacy explanation, regenerate". */
  enrichment_json?: string | null;
}

export interface TranslationItem {
  id: number;
  source_text: string;
  result_text: string;
  source_lang: string;
  target_lang: string;
  provider: string;
  mode: string;
  cluster_tag: string | null;
  created_at: string;
}

export interface EnrichmentInput {
  /** The freeform markdown explanation, META line already stripped. */
  text: string;
  /** Short (<=10 char) Chinese gloss parsed from the META line, for quiz cards. */
  zhShort?: string;
  /** CEFR level parsed from the META line. */
  level?: string;
}

export interface DocumentListItem {
  id: number;
  title: string;
  tags: string;
  pinned: boolean;
  word_count: number;
  created_at: string;
  updated_at: string;
  content_text: string;
  protected: boolean;
  unlocked: boolean;
  /** Folded out of the main list into the archive section. */
  archived: boolean;
}

export interface DocumentDetail {
  id: number;
  title: string;
  content: string;
  content_text: string;
  tags: string;
  pinned: boolean;
  word_count: number;
  created_at: string;
  updated_at: string;
  protected: boolean;
}

export interface DocumentListResult {
  items: DocumentListItem[];
  total: number;
}

export interface DashboardStats {
  word_count: number;
  pattern_count: number;
  chat_count: number;
  doc_count: number;
  recent_words: { id: number; word: string; zh: string; level: string; updated_at: string }[];
  recent_docs: { id: number; title: string; updated_at: string }[];
}

export type SrsState = "new" | "learning" | "review" | "relearning";
export type SrsRating = "again" | "hard" | "good";

export interface DueCard {
  word_id: number;
  word: string;
  zh: string;
  level: string | null;
  context_sentence: string;
  state: SrsState;
}

export interface ReviewResult {
  next_review_at: string;
  scheduled_days: number;
  state: SrsState;
}

export interface SearchHistoryItem {
  word: string;
  searched_at: string;
  in_vocab: boolean;
}

// ── RSS Feeds ────────────────────────────────────────────────────────────────

export interface RssFeedMeta {
  title: string;
  description: string;
  site_link: string;
  entries: RssEntry[];
}

export interface RssEntry {
  title: string;
  url: string;
  author: string;
  summary: string;
  published: string;
  /** Podcast enclosure (direct mp3/m4a URL); null for regular article entries. */
  audio_url?: string | null;
  /** Episode length in seconds, when the feed provides it. */
  audio_duration?: number | null;
  /** Hacker News item id, when this entry came from an hnrss.org-style feed. */
  hn_item_id?: number | null;
}

export interface RssFeed {
  id: number;
  title: string;
  url: string;
  site_link: string;
  description: string;
  last_fetched_at: string | null;
  created_at: string;
  /** True when any cached entry carries an audio enclosure — grouped as "Podcasts" in the UI. */
  is_podcast?: boolean;
  category: "article" | "podcast";
  category_override: "article" | "podcast" | null;
  is_pinned: boolean;
  pin_order: number | null;
}

/** A cached entry row from the rss_entries table (plan2.md §A). */
export interface RssEntryRow {
  id: number;
  feed_id: number;
  title: string;
  url: string;
  author: string;
  summary: string;
  image_url: string | null;
  /** Podcast enclosure (direct mp3/m4a URL); null for regular article entries. */
  audio_url?: string | null;
  /** Episode length in seconds, when the feed provides it. */
  audio_duration?: number | null;
  /** Hacker News item id, when this entry came from an hnrss.org-style feed. */
  hn_item_id?: number | null;
  published: string;
  is_read: boolean;
  fetched_at: string;
}

/** Which database the app is talking to, and what that profile supports.
 *  Mirrors `DbDescriptor` in src-tauri/src/db/connection.rs. */
export interface DbConnection {
  kind: "local" | "turso";
  /** The SQLite file. For a Turso profile this is the local replica. */
  path: string;
  remoteUrl: string | null;
  caps: {
    /** VACUUM INTO backup export. Off for Turso. */
    export: boolean;
    /** Whether the profile can be repointed at another file. */
    switchPath: boolean;
    /** Whether an explicit pull-from-primary is meaningful. */
    sync: boolean;
    /** False when serving a replica offline — it is opened read-only, so any
     *  save will fail at the driver. */
    writable: boolean;
  };
  /** A Turso profile falling back to its local replica because the primary
   *  couldn't be reached. Reads are real (possibly stale) data. */
  offline: boolean;
}

/** One source row that already exists in the target, with both sides described
 *  so the user can choose. Mirrors `ImportConflict` in db/import.rs. */
export interface ImportConflict {
  /** Natural key — echo it back in the decisions to overwrite this row. */
  key: string;
  title: string;
  incoming: string;
  existing: string;
}

export type ImportKind = "words" | "patterns" | "articles" | "documents" | "knownWords";

export interface ImportGroup {
  kind: ImportKind;
  newCount: number;
  conflicts: ImportConflict[];
}

export interface ImportPlan {
  sourcePath: string;
  groups: ImportGroup[];
}

/** Anything not listed under `overwrite` is skipped, so the safe choice needs
 *  no bookkeeping on this side. */
export interface ImportDecisions {
  overwrite: Partial<Record<ImportKind, string[]>>;
  includeNew: boolean;
}

export interface ImportOutcome {
  kind: ImportKind;
  added: number;
  overwritten: number;
  skipped: number;
}

export interface ImportResult {
  outcomes: ImportOutcome[];
  added: number;
  overwritten: number;
  skipped: number;
}
