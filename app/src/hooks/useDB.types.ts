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
  /** Normalised relative folder path; "" is the library root. */
  folder: string;
  /** Number of checklist blocks in the document, and how many are checked. */
  task_total: number;
  task_done: number;
  /** Lifecycle status; "" means none. See `DocStatus`. */
  status: DocStatus;
}

/** Document lifecycle status. "" is "None"; the other four are the closed
 *  set mirrored from `STATUS_VALUES` in core/src/db/documents/crud.rs — a
 *  free-text status becomes an un-filterable mess, so both sides enforce it. */
export type DocStatus = "" | "active" | "onhold" | "completed" | "dropped";

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
  /** Normalised relative folder path; "" is the library root. */
  folder: string;
  /** Lifecycle status; "" means none. */
  status: DocStatus;
}

export interface DocumentFolder {
  path: string;
  /** Everything filed here is encrypted, including what arrives later. */
  locked: boolean;
}

export interface DocumentListResult {
  items: DocumentListItem[];
  total: number;
}

export interface DashboardStats {
  word_count: number;
  sentence_count: number;
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
  /** Excluded from bulk/background refreshes; direct channel visits may still sync it. */
  is_paused: boolean;
}

/** One persisted feed/HN bookmark. */
export interface FeedBookmark {
  id: number;
  url: string;
  title: string;
  feed_title: string;
  domain: string;
  summary: string;
  image_url: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  hn_item_id: number | null;
  published: string;
  created_at: string;
}

/** Metadata passed when bookmarking from any feed/HN surface. */
export interface FeedBookmarkInput {
  url: string;
  title: string;
  feedTitle: string;
  domain: string;
  summary: string;
  imageUrl: string | null;
  audioUrl: string | null;
  audioDuration: number | null;
  hnItemId: number | null;
  published: string;
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
  kind: "local" | "turso" | "postgres";
  /** The SQLite file. For a Turso profile this is the local replica; empty
   *  for Postgres, which has no local file. */
  path: string;
  remoteUrl: string | null;
  caps: {
    /** VACUUM INTO backup export. Off for Turso and Postgres. */
    export: boolean;
    /** Whether the profile can be repointed at another file. */
    switchPath: boolean;
    /** Whether an explicit pull-from-primary is meaningful. Off for Postgres
     *  — it's a direct connection with no replica to sync from. */
    sync: boolean;
    /** False when serving a replica offline — it is opened read-only, so any
     *  save will fail at the driver. */
    writable: boolean;
    /** Whether VACUUM is supported. Off for Turso/self-hosted sqld/Postgres —
     *  their storage isn't a plain rolling SQLite file, and VACUUM is
     *  rejected outright by the server itself, not just proxying. */
    vacuum: boolean;
  };
  /** A Turso profile falling back to its local replica because the primary
   *  couldn't be reached. Reads are real (possibly stale) data. */
  offline: boolean;
}

/** Last Turso connection kept across an explicit disconnect. Mirrors
 *  `RememberedTursoConnection` in core/src/db/settings.rs. */
export interface RememberedTursoConnection {
  url: string | null;
  tokenPresent: boolean;
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

export type ImportKind = "words" | "sentences" | "articles" | "documents" | "knownWords";

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

/** Payload of the `"import-progress"` event, emitted while a merge import
 *  (`importApply`) runs. Mirrors `ImportProgress` in db/import/types.rs. */
export interface ImportProgress {
  step: ImportKind;
  stepIndex: number;
  stepTotal: number;
  done: number;
  total: number;
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

/** Result of a full-overwrite import (`db_import_overwrite`): every table in
 *  the source database replaced the target's, not just the natural-keyed
 *  subset a regular import merges. */
export interface OverwriteResult {
  tables: string[];
  rowsCopied: number;
  /** Rows too large for one write to a remote target to carry (e.g. a
   *  multi-megabyte background image in `user_settings`) — left out rather
   *  than failing the whole import. Always empty against a local database. */
  skipped: string[];
}

/** A web account's dedicated sqld container — lets a desktop app connect
 *  directly (Settings > Cloud tab) and share this account's data live.
 *  Unrelated to the `turso*`/`DbConnection` types above (a user-supplied
 *  external target) — this is server-provisioned. `token` is only present
 *  right after `enableRemoteAccess`/`rotateRemoteAccess`, never on a plain
 *  status read. */
export interface RemoteAccessStatus {
  enabled: boolean;
  url: string | null;
  token?: string;
}

/** Payload of the `"overwrite-progress"` event, emitted while
 *  `importOverwrite` runs. Mirrors `OverwriteProgress` in
 *  db/import/overwrite.rs. */
export interface OverwriteProgress {
  phase: "clearing" | "copying" | "indexing";
  table: string;
  tableIndex: number;
  tableTotal: number;
}

/** Payload of the `"postgres-export-progress"` event, emitted while
 *  `exportPostgresBackup` runs. Mirrors `PostgresExportProgress` in
 *  db/settings.rs — same shape as `OverwriteProgress`, own event name so the
 *  two operations' listeners never cross-talk. */
export interface PostgresExportProgress {
  phase: "clearing" | "copying";
  table: string;
  tableIndex: number;
  tableTotal: number;
}
