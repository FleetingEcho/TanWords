#!/usr/bin/env node
/**
 * generate-cli.mjs — batch-generate TanWords content via any OpenAI-compatible
 * local model (Ollama, LM Studio, vLLM, llama.cpp server, ...) and write it
 * straight into the app's SQLite DB.
 *
 * Setup:
 *   cp generate.config.example.json generate.config.json
 *   # edit baseUrl / model to point at your local endpoint
 *
 * Usage:
 *   node server/generate-cli.mjs words     [--topics "AI,climate,economics"] [--count 30]
 *   node server/generate-cli.mjs articles  [--topics "remote work,open source"] [--count 5]
 *   node server/generate-cli.mjs documents [--topics "读书笔记,项目复盘"] [--count 5]
 *   node server/generate-cli.mjs enrich    [--count 50] [--all] [--words "resilient,tenuous"]
 *   node server/generate-cli.mjs all       [--count 20]     # runs all four with defaults
 *
 * enrich: backfills the freeform AI explanation (words.enrichment_text —
 * same format the app itself generates: a short Chinese gloss plus a free-
 * form markdown write-up with 4-6+ example blockquotes) for words ALREADY
 * in the vocabulary that don't have it yet — e.g. words accepted straight
 * from a reading lesson, which only get a bare word+translation. Pass --all
 * to re-enrich every word regardless of current state, or --words to target
 * specific ones.
 *
 * Every run backs up the DB first (tanwords.db.backup-<timestamp>). Nothing
 * is wiped — this only adds rows, with the same dedup rules the app itself
 * uses (words: UNIQUE(word)).
 */
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// ── Config ──────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(REPO_ROOT, "generate.config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`[generate] Missing ${CONFIG_PATH}`);
  console.error(`Run: cp generate.config.example.json generate.config.json, then edit it.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
if (!config.baseUrl || !config.model) {
  console.error("[generate] generate.config.json needs at least baseUrl and model set.");
  process.exit(1);
}
const TARGET_LEVEL = config.targetLevel || "C1";

// ── DB ──────────────────────────────────────────────────────────────────
function defaultDbPath() {
  const platform = process.platform;
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "tanwords", "tanwords.db");
  if (platform === "win32") return path.join(process.env.APPDATA || os.homedir(), "tanwords", "tanwords.db");
  return path.join(os.homedir(), ".local", "share", "tanwords", "tanwords.db");
}
const DB_PATH = config.dbPath || defaultDbPath();
if (!fs.existsSync(DB_PATH)) {
  console.error(`[generate] DB not found at ${DB_PATH}. Run the TanWords app once first.`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${DB_PATH}.backup-${stamp}`;
fs.copyFileSync(DB_PATH, backupPath);
for (const suffix of ["-wal", "-shm"]) {
  const p = DB_PATH + suffix;
  if (fs.existsSync(p)) fs.copyFileSync(p, backupPath + suffix);
}
console.log(`[generate] backed up DB to ${backupPath}`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Model client ────────────────────────────────────────────────────────
async function callModel(systemPrompt, userPrompt) {
  const base = config.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
    }),
  });
  if (!res.ok) throw new Error(`model request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonText = content.trim().replace(/^```(json)?\n?/, "").replace(/```\s*$/, "");
  return JSON.parse(jsonText);
}

/** Retry once on parse/model failure — local models occasionally wrap JSON in prose. */
async function callModelSafe(systemPrompt, userPrompt, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await callModel(systemPrompt, userPrompt);
    } catch (e) {
      console.warn(`[generate] ${label} attempt ${attempt} failed: ${e.message}`);
      if (attempt === 2) return null;
    }
  }
}

// ── Arg parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}
const [, , mode, ...rest] = process.argv;
const args = parseArgs(rest);
const COUNT = parseInt(args.count || "20", 10);
const listArg = (v, fallback) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback);

const DEFAULT_WORD_TOPICS = ["software engineering", "business & startups", "science & technology", "everyday abstract reasoning"];
const DEFAULT_ARTICLE_TOPICS = ["remote work culture", "AI ethics", "urban planning", "personal productivity", "open source sustainability"];

// ── Prepared statements ─────────────────────────────────────────────────
// Mirrors the Rust `db_add_word_enriched` command's write contract exactly:
// words.enrichment_text holds the freeform markdown body; word_definitions
// gets at most one seed row (pos='other', zh=<short gloss>) purely so quiz
// cards have a gloss, never overwritten if one already exists. No more
// word_etymology (dead table, unused by the app) or enrichment_json (legacy
// column — writing it makes the app show a "legacy, please regenerate" banner
// instead of the actual content).
const insWord = db.prepare("INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source) VALUES (?,?,?,1,?)");
const findWordId = db.prepare("SELECT id FROM words WHERE word = ?");
const hasDef = db.prepare("SELECT EXISTS(SELECT 1 FROM word_definitions WHERE word_id = ?) AS n");
const insSeedDef = db.prepare("INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?, 'other', ?, 0)");
const updEnrichText = db.prepare("UPDATE words SET enrichment_text=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
const insSrs = db.prepare("INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?, 'word', 0, 2.5)");
const updWordLevel = db.prepare("UPDATE words SET level=COALESCE(level, ?) WHERE id=?");

/** Seed a word_definitions row for the quiz-card gloss, but only if this word
 *  doesn't already have one — same guard as the Rust command. */
function seedDefIfMissing(wordId, zhShort) {
  if (!zhShort) return;
  const { n } = hasDef.get(wordId);
  if (!n) insSeedDef.run(wordId, zhShort);
}

const insArticle = db.prepare("INSERT INTO articles (title, source_url, origin, content) VALUES (?,?,?,?)");
const insItem = db.prepare("INSERT INTO extracted_items (article_id, kind, text, zh, note, level, context_sentence, status) VALUES (?,?,?,?,?,?,?, 'candidate')");

const insDoc = db.prepare("INSERT INTO documents (title, content, content_text, tags, pinned, word_count) VALUES (?,?,?,?,0,?)");

// ── words mode ──────────────────────────────────────────────────────────
async function genWords() {
  const topics = listArg(args.topics, DEFAULT_WORD_TOPICS);
  const CHUNK = 10;
  let added = 0, skipped = 0;

  const system = `You are a lexicographer building a vocabulary database for a ${TARGET_LEVEL}-level Chinese-native English learner. For each request, invent ${CHUNK} DISTINCT, useful ${TARGET_LEVEL}/C2-level English words or short phrases related to the given topic — words a serious learner would actually want to look up, not obscure trivia.

Return ONLY a JSON array (no markdown fences, no prose) of objects with EXACTLY these keys:
{
  "word": "lowercase dictionary form",
  "wordType": "n|v|adj|adv|phrase",
  "level": "B2|C1|C2",
  "zhShort": "10字以内的中文短释义，用于速记卡片",
  "text": "中文讲解正文（markdown），自由组织内容：核心释义、常见用法、易混淆点、词源、记忆方法等，该长则长该短则短，不必覆盖每一类。硬性要求：(1) 至少4-6条例句，覆盖不同词义/词性/语域（日常口语、书面/学术、新闻财经等），每条例句写成 '> ' 开头的 markdown blockquote，可在同一 blockquote 内下一行附中文翻译；(2) 搭配(collocations)、常见句型、近义词细微差别、使用场合等常见用法要讲透，不要一笔带过。"
}`;

  for (const topic of topics) {
    const batches = Math.ceil(COUNT / topics.length / CHUNK) || 1;
    for (let b = 0; b < batches; b++) {
      const items = await callModelSafe(system, `Topic: ${topic}. Generate ${CHUNK} words now.`, `words[${topic}]`);
      if (!Array.isArray(items)) continue;
      const tx = db.transaction((rows) => {
        for (const w of rows) {
          if (!w.word) continue;
          const word = String(w.word).trim().toLowerCase();
          const result = insWord.run(word, w.wordType ?? null, w.level ?? TARGET_LEVEL, "ai");
          if (result.changes === 0) { skipped++; continue; }
          const { id } = findWordId.get(word);
          seedDefIfMissing(id, w.zhShort);
          insSrs.run(id);
          updEnrichText.run(w.text || "", id);
          added++;
        }
      });
      tx(items);
      console.log(`[words] ${topic} batch ${b + 1}/${batches}: +${items.length} candidates (added ${added} so far, skipped ${skipped} dupes)`);
    }
  }
  console.log(`[words] done: ${added} added, ${skipped} skipped (already in vocab)`);
}

// ── enrich mode ─────────────────────────────────────────────────────────
// Backfills words.enrichment_text for words already in the vocab (e.g.
// accepted straight from a reading lesson via db_add_word — just
// word+translation, no freeform explanation yet). Never inserts new words.
async function genEnrichExisting() {
  const targetWords = listArg(args.words, null);
  let rows;
  if (targetWords) {
    const placeholders = targetWords.map(() => "?").join(",");
    rows = db
      .prepare(`SELECT id, word, word_type, level FROM words WHERE LOWER(word) IN (${placeholders})`)
      .all(...targetWords.map((w) => w.toLowerCase()));
  } else {
    const whereClause = args.all ? "1=1" : "enrichment_text IS NULL";
    rows = db.prepare(`SELECT id, word, word_type, level FROM words WHERE ${whereClause} ORDER BY id LIMIT ?`).all(COUNT);
  }

  if (rows.length === 0) {
    console.log("[enrich] nothing to do — no words matched (everything may already be enriched; pass --all to re-enrich).");
    return;
  }

  const CHUNK = 8;
  let updated = 0, missing = 0;

  const system = `You are a lexicographer enriching an EXISTING vocabulary database for a ${TARGET_LEVEL}-level Chinese-native English learner. You will be given a list of words that are ALREADY saved — do NOT invent new words, do NOT skip any, do NOT change their spelling. Return exactly one enrichment entry per given word, using the identical spelling you were given.

Return ONLY a JSON array (no markdown fences, no prose) of objects with EXACTLY these keys:
{
  "word": "must exactly match one of the given words, lowercase",
  "wordType": "n|v|adj|adv|phrase",
  "level": "B2|C1|C2",
  "zhShort": "10字以内的中文短释义，用于速记卡片",
  "text": "中文讲解正文（markdown），自由组织内容：核心释义、常见用法、易混淆点、词源、记忆方法等，该长则长该短则短，不必覆盖每一类。硬性要求：(1) 至少4-6条例句，覆盖不同词义/词性/语域（日常口语、书面/学术、新闻财经等），每条例句写成 '> ' 开头的 markdown blockquote，可在同一 blockquote 内下一行附中文翻译；(2) 搭配(collocations)、常见句型、近义词细微差别、使用场合等常见用法要讲透，不要一笔带过。"
}`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const wordList = batch.map((r) => r.word).join(", ");
    const items = await callModelSafe(system, `Words: ${wordList}`, `enrich[batch ${Math.floor(i / CHUNK) + 1}]`);
    if (!Array.isArray(items)) { missing += batch.length; continue; }

    const byWord = new Map(batch.map((r) => [r.word.toLowerCase(), r]));

    const tx = db.transaction((results) => {
      for (const w of results) {
        if (!w.word) continue;
        const row = byWord.get(String(w.word).trim().toLowerCase());
        if (!row) continue; // model returned a word we didn't ask for — ignore rather than guess which one it meant
        byWord.delete(row.word.toLowerCase());

        // Re-enrichment overwrites the old body text — no dedup concern since
        // it's a single column, not accumulating rows like the old
        // definitions/etymology tables did.
        seedDefIfMissing(row.id, w.zhShort);
        updWordLevel.run(w.level ?? row.level ?? TARGET_LEVEL, row.id);
        updEnrichText.run(w.text || "", row.id);
        updated++;
      }
    });
    tx(items);
    missing += byWord.size; // words the model silently dropped from this batch
    console.log(`[enrich] batch ${Math.floor(i / CHUNK) + 1}/${Math.ceil(rows.length / CHUNK)}: ${items.length}/${batch.length} returned (${updated} enriched so far)`);
  }
  console.log(`[enrich] done: ${updated} words enriched, ${missing} words the model dropped/failed`);
}

// ── articles mode ───────────────────────────────────────────────────────
async function genArticles() {
  const topics = listArg(args.topics, DEFAULT_ARTICLE_TOPICS);
  const n = Math.min(COUNT, topics.length * 3);
  let added = 0, droppedItems = 0;

  const system = `You write short original English essays (200-300 words) for a ${TARGET_LEVEL}-level Chinese English learner, in the style of a thoughtful tech/culture blog. You also extract learnable vocabulary FROM YOUR OWN TEXT.

CRITICAL RULE: for every extracted item, "text" MUST be an EXACT, VERBATIM, case-sensitive substring that appears in your "content" field. This is non-negotiable — items whose text doesn't literally appear in the article will be discarded.

Return ONLY JSON (no markdown fences) with this shape:
{
  "title": "...",
  "content": "200-300 word essay, 4-5 paragraphs",
  "items": [
    {"kind": "word", "text": "<verbatim word from content>", "zh": "...", "level": "${TARGET_LEVEL}", "note": "brief Chinese usage note", "context": "<verbatim sentence containing it>"}
  ]
}
Include 4-6 word items.`;

  for (let i = 0; i < n; i++) {
    const topic = topics[i % topics.length];
    const result = await callModelSafe(system, `Topic: ${topic}. Write the essay and extract items now.`, `article[${topic}]`);
    if (!result?.content || !Array.isArray(result.items)) continue;

    const validItems = result.items.filter((it) => {
      const ok = it.text && result.content.toLowerCase().includes(String(it.text).toLowerCase());
      if (!ok) droppedItems++;
      return ok;
    });

    const { lastInsertRowid: articleId } = insArticle.run(result.title || topic, "", "pasted", result.content);
    for (const it of validItems) {
      insItem.run(articleId, "word", it.text, it.zh || "", it.note || "", it.level || TARGET_LEVEL, it.context || it.text);
    }
    added++;
    console.log(`[articles] "${result.title}" — ${validItems.length}/${result.items.length} items kept`);
  }
  console.log(`[articles] done: ${added} articles added, ${droppedItems} items dropped (not verbatim in content)`);
}

// ── documents mode ──────────────────────────────────────────────────────
// Content is stored as a JSON array of BlockNote blocks (see src/lib/docFormat.ts
// on the app side) — the simplest valid block is {"type":"paragraph","content":"..."}.
async function genDocuments() {
  const topics = listArg(args.topics, [
    "个人写作句式速查笔记", "本周精读笔记", "词汇复盘", "项目复盘", "读书清单",
  ]);
  const n = Math.min(COUNT, topics.length);
  let added = 0;

  const system = `You help a ${TARGET_LEVEL}-level Chinese English learner keep personal study notes in a note-taking app. Write a short note (Chinese, 3-6 paragraphs, each 1-3 sentences) on the given topic — the voice should read like the learner's own reflective notes about their English study (vocabulary, sentence patterns, articles they read, project retrospectives, reading lists), not like a textbook.

Return ONLY JSON (no markdown fences):
{
  "title": "concise Chinese title",
  "paragraphs": ["段落1", "段落2", "..."],
  "tags": ["1-3 short Chinese tags"]
}`;

  for (let i = 0; i < n; i++) {
    const topic = topics[i % topics.length];
    const result = await callModelSafe(system, `Topic: ${topic}. Write the note now.`, `document[${topic}]`);
    if (!result?.title || !Array.isArray(result.paragraphs) || result.paragraphs.length === 0) continue;

    const blocks = result.paragraphs.map((p) => ({ type: "paragraph", content: String(p) }));
    const content = JSON.stringify(blocks);
    const contentText = result.paragraphs.join("\n");
    const wordCount = contentText.trim() ? contentText.trim().split(/\s+/).length : 0;
    insDoc.run(result.title, content, contentText, JSON.stringify(result.tags ?? []), wordCount);
    added++;
    console.log(`[documents] "${result.title}" — ${result.paragraphs.length} paragraphs`);
  }
  console.log(`[documents] done: ${added} documents added`);
}

// ── main ────────────────────────────────────────────────────────────────
const MODES = { words: genWords, articles: genArticles, documents: genDocuments, enrich: genEnrichExisting };

if (mode === "all") {
  await genWords();
  await genArticles();
  await genDocuments();
  await genEnrichExisting();
} else if (MODES[mode]) {
  await MODES[mode]();
} else {
  console.error(`Usage: node server/generate-cli.mjs <words|articles|documents|enrich|all> [--topics "a,b"] [--count N] [--all] [--words "a,b"]`);
  process.exit(1);
}

db.close();
console.log("[generate] all done.");
