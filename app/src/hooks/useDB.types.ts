/** Shared type definitions for the useDB hook family (useDB.core.ts / useDB.extra.ts). */

export interface ChatSessionItem {
  id: string;
  title: string;
  preset_id: string;
  provider_id: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionDetail extends ChatSessionItem {
  messages: string;       // JSON string
  system_prompt: string;
}

export interface ArticleListItem {
  id: number;
  title: string;
  source_url: string;
  origin: string;
  created_at: string;
  item_count: number;
  accepted_count: number;
}

export interface ExtractedItem {
  id: number;
  article_id: number;
  /** "word": vocabulary; "sentence": a highlight sentence / advanced pattern —
   * text is the verbatim sentence, context_sentence holds the pattern skeleton. */
  kind: "word" | "sentence";
  text: string;
  zh: string;
  note: string;
  level: string;
  context_sentence: string;
  status: "candidate" | "accepted" | "known" | "dismissed";
}

export interface ArticleDetail {
  id: number;
  title: string;
  source_url: string;
  origin: string;
  content: string;
  created_at: string;
  items: ExtractedItem[];
}

export interface NewExtractedItem {
  kind: "word" | "sentence";
  text: string;
  zh: string;
  note: string;
  level: string;
  context: string;
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
}

export interface DocumentListResult {
  items: DocumentListItem[];
  total: number;
}

export interface DashboardStats {
  word_count: number;
  words_this_week: number;
  article_count: number;
  doc_count: number;
  known_count: number;
  resume: {
    article_id: number;
    title: string;
    origin: string;
    total: number;
    processed: number;
  } | null;
  recent_words: { id: number; word: string; zh: string; level: string; created_at: string }[];
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
  published: string;
  is_read: boolean;
  fetched_at: string;
}
