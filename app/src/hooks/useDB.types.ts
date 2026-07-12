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
  kind: "word" | "pattern";
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
  kind: "word" | "pattern";
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
  phonetics: {
    locale: string;
    ipa: string;
    accent_label: string | null;
  }[];
  etymology: {
    parts: string | null;
    story: string | null;
    origin_lang: string | null;
  } | null;
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
  definitions: { pos: string; zh: string; en?: string; exampleEn?: string; exampleZh?: string }[];
  synonyms: { word: string; note?: string; noteZh?: string }[];
  antonyms: string[];
  collocations: string[];
  derivatives: { word: string; wordType?: string; word_type?: string; zh?: string }[];
  sentencePatterns: { pattern: string; explanation?: string; example?: string }[];
  sentence_patterns?: { pattern: string; explanation?: string; example?: string }[];
  idioms: { idiom: string; explanation?: string; example?: string }[];
  authorityQuotes: { text: string; source?: string }[];
  authority_quotes?: { text: string; source?: string }[];
  etymology?: { parts?: { seg: string; role: string; meaning: string }[] | string; story?: string; originLang?: string; origin_lang?: string };
  level?: string;
  mnemonic?: string;
  complete?: boolean;
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

// ── Sentence patterns (句式库) ──────────────────────────────────────────────
// Backend contract: Rust commands db_add_pattern / db_get_patterns /
// db_get_pattern_detail / db_update_pattern_analysis / db_delete_pattern
// (migration v5, tables `patterns` + `pattern_examples`).

/** Pragmatic function of a pattern — drives the library's filter chips. */
export type PatternTag =
  | "contrast"    // 对比
  | "concession"  // 让步
  | "emphasis"    // 强调
  | "causal"      // 因果
  | "condition"   // 条件
  | "comparison"  // 比较
  | "example"     // 例证
  | "other";

export interface PatternListItem {
  id: number;
  pattern: string;          // 句式骨架或代表句
  zh: string;
  function_tag: PatternTag;
  level: string | null;
  example_count: number;
  has_analysis: boolean;
  created_at: string;
}

export interface PatternExample {
  id: number;
  sentence: string;
  source: string;           // 文章标题 / "manual"
  article_id: number | null;
  created_at: string;
}

export interface PatternDetail {
  id: number;
  pattern: string;
  zh: string;
  function_tag: PatternTag;
  level: string | null;
  note: string;
  /** AI 深度分析,markdown 文本;null = 尚未分析 */
  analysis: string | null;
  created_at: string;
  examples: PatternExample[];
}

export interface NewPattern {
  pattern: string;
  zh: string;
  note?: string;
  level?: string;
  functionTag?: PatternTag;
  /** 首个真实例句及其出处;同骨架已存在时后端应追加例句而非重复建条目 */
  example?: { sentence: string; source: string; articleId?: number };
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
}

export interface RssFeed {
  id: number;
  title: string;
  url: string;
  site_link: string;
  description: string;
  last_fetched_at: string | null;
  created_at: string;
}

// ── Pattern Practice (造句练习) ─────────────────────────────────────────────

export interface PracticeRecord {
  id: number;
  sentence: string;
  feedback: string;
  verdict: "good" | "okay" | "wrong" | "";
  saved: boolean;
  created_at: string;
}
