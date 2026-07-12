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
 *   node server/generate-cli.mjs patterns  [--skeletons "not so much X as Y,..."] [--count 15]
 *   node server/generate-cli.mjs documents [--topics "读书笔记,项目复盘"] [--count 5]
 *   node server/generate-cli.mjs enrich    [--count 50] [--all] [--words "resilient,tenuous"]
 *   node server/generate-cli.mjs all       [--count 20]     # runs all five with defaults
 *
 * enrich: backfills full AI enrichment (definitions/synonyms/antonyms/
 * collocations/etymology/mnemonic) for words ALREADY in the vocabulary that
 * don't have it yet — e.g. words accepted straight from a reading lesson,
 * which only get a bare word+translation. Pass --all to re-enrich every
 * word regardless of current state, or --words to target specific ones.
 *
 * Every run backs up the DB first (tanwords.db.backup-<timestamp>). Nothing
 * is wiped — this only adds rows, with the same dedup rules the app itself
 * uses (words: UNIQUE(word); patterns: case/whitespace-insensitive skeleton
 * match, appending a new example instead of duplicating).
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

const hasPatterns = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patterns'").get();
if (!hasPatterns) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT NOT NULL, zh TEXT NOT NULL DEFAULT '',
        function_tag TEXT NOT NULL DEFAULT 'other', level TEXT, note TEXT NOT NULL DEFAULT '',
        analysis TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pattern_examples (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pattern_id INTEGER NOT NULL, sentence TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '', article_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(pattern_id) REFERENCES patterns(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_examples_pattern ON pattern_examples(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_pattern_examples_article ON pattern_examples(article_id);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (5)").run();
  console.log("[generate] applied migration v5 (patterns) — DB hadn't been migrated yet");
}

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
const VALID_TAGS = ["contrast", "concession", "emphasis", "causal", "condition", "comparison", "example", "other"];

// ── Prepared statements ─────────────────────────────────────────────────
const insWord = db.prepare("INSERT OR IGNORE INTO words (word, word_type, level, word_freq, mnemonic, source) VALUES (?,?,?,1,?,?)");
const findWordId = db.prepare("SELECT id FROM words WHERE word = ?");
const insDef = db.prepare("INSERT INTO word_definitions (word_id, pos, zh, en, example_en, example_zh, sort_order) VALUES (?,?,?,?,?,?,0)");
const insEty = db.prepare("INSERT INTO word_etymology (word_id, parts, story, origin_lang) VALUES (?,?,?,?)");
const updEnrich = db.prepare("UPDATE words SET enrichment_json=? WHERE id=?");
const insSrs = db.prepare("INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?, 'word', 0, 2.5)");
const delDefs = db.prepare("DELETE FROM word_definitions WHERE word_id = ?");
const delEty = db.prepare("DELETE FROM word_etymology WHERE word_id = ?");
const updWordMeta = db.prepare("UPDATE words SET mnemonic=?, level=COALESCE(level, ?), updated_at=CURRENT_TIMESTAMP WHERE id=?");

const insArticle = db.prepare("INSERT INTO articles (title, source_url, origin, content) VALUES (?,?,?,?)");
const insItem = db.prepare("INSERT INTO extracted_items (article_id, kind, text, zh, note, level, context_sentence, status) VALUES (?,?,?,?,?,?,?, 'candidate')");

const findPattern = db.prepare("SELECT id, zh, note, level FROM patterns WHERE LOWER(TRIM(pattern)) = LOWER(?)");
const insPattern = db.prepare("INSERT INTO patterns (pattern, zh, function_tag, level, note, analysis) VALUES (?,?,?,?,?,?)");
const updPatternFields = db.prepare("UPDATE patterns SET zh=?, note=?, level=? WHERE id=?");
const findExample = db.prepare("SELECT id FROM pattern_examples WHERE pattern_id=? AND TRIM(sentence)=?");
const insExample = db.prepare("INSERT INTO pattern_examples (pattern_id, sentence, source, article_id) VALUES (?,?,?,?)");

const insDoc = db.prepare("INSERT INTO documents (title, content, content_text, tags, pinned, word_count) VALUES (?,?,?,?,0,?)");

// ── words mode ──────────────────────────────────────────────────────────
async function genWords() {
  const topics = listArg(args.topics, DEFAULT_WORD_TOPICS);
  const CHUNK = 10;
  let added = 0, skipped = 0;

  const system = `You are a lexicographer building a vocabulary database for a ${TARGET_LEVEL}-level English learner (a software engineer studying for IELTS). For each request, invent ${CHUNK} DISTINCT, useful ${TARGET_LEVEL}/C2-level English words or short phrases related to the given topic — words a serious learner would actually want to look up, not obscure trivia.

Return ONLY a JSON array (no markdown fences, no prose) of objects with EXACTLY these keys:
{
  "word": "lowercase dictionary form",
  "wordType": "n|v|adj|adv|phrase",
  "level": "B2|C1|C2",
  "zh": "concise Chinese meaning",
  "exampleEn": "one natural example sentence, ideally tech/business flavored",
  "exampleZh": "its Chinese translation",
  "mnemonic": "a short Chinese memory aid, can reference word roots",
  "synonyms": [{"word": "...", "note": "short English usage note", "noteZh": "short Chinese usage note"}],
  "antonyms": ["..."],
  "collocations": ["common phrase using the word", "..."],
  "etymology": {"originLang": "Latin|Greek|...", "parts": [{"seg": "...", "role": "前缀|词根|后缀", "meaning": "..."}], "story": "1-2 sentence Chinese explanation of the word's origin"}
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
          const result = insWord.run(word, w.wordType ?? null, w.level ?? TARGET_LEVEL, w.mnemonic ?? null, "ai");
          if (result.changes === 0) { skipped++; continue; }
          const { id } = findWordId.get(word);
          insDef.run(id, w.wordType || "other", w.zh || "", null, w.exampleEn ?? null, w.exampleZh ?? null);
          insSrs.run(id);
          if (w.etymology) insEty.run(id, JSON.stringify(w.etymology.parts ?? []), w.etymology.story ?? null, w.etymology.originLang ?? null);
          const enrichment = {
            definitions: [{ pos: w.wordType || "other", zh: w.zh || "", en: null, exampleEn: w.exampleEn, exampleZh: w.exampleZh }],
            synonyms: w.synonyms ?? [], antonyms: w.antonyms ?? [], collocations: w.collocations ?? [],
            derivatives: [], sentencePatterns: [], idioms: [], authorityQuotes: [],
            etymology: w.etymology, level: w.level ?? TARGET_LEVEL, mnemonic: w.mnemonic, complete: true,
          };
          updEnrich.run(JSON.stringify(enrichment), id);
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
// Backfills full enrichment for words already in the vocab (e.g. accepted
// straight from a reading lesson via db_add_word — just word+translation,
// no definitions/synonyms/etymology). Never inserts new words.
async function genEnrichExisting() {
  const targetWords = listArg(args.words, null);
  let rows;
  if (targetWords) {
    const placeholders = targetWords.map(() => "?").join(",");
    rows = db
      .prepare(`SELECT id, word, word_type, level FROM words WHERE LOWER(word) IN (${placeholders})`)
      .all(...targetWords.map((w) => w.toLowerCase()));
  } else {
    const whereClause = args.all ? "1=1" : "enrichment_json IS NULL";
    rows = db.prepare(`SELECT id, word, word_type, level FROM words WHERE ${whereClause} ORDER BY id LIMIT ?`).all(COUNT);
  }

  if (rows.length === 0) {
    console.log("[enrich] nothing to do — no words matched (everything may already be enriched; pass --all to re-enrich).");
    return;
  }

  const CHUNK = 8;
  let updated = 0, missing = 0;

  const system = `You are a lexicographer enriching an EXISTING vocabulary database for a ${TARGET_LEVEL}-level English learner (a software engineer studying for IELTS). You will be given a list of words that are ALREADY saved — do NOT invent new words, do NOT skip any, do NOT change their spelling. Return exactly one enrichment entry per given word, using the identical spelling you were given.

Return ONLY a JSON array (no markdown fences, no prose) of objects with EXACTLY these keys:
{
  "word": "must exactly match one of the given words, lowercase",
  "wordType": "n|v|adj|adv|phrase",
  "level": "B2|C1|C2",
  "zh": "concise Chinese meaning",
  "exampleEn": "one natural example sentence, ideally tech/business flavored",
  "exampleZh": "its Chinese translation",
  "mnemonic": "a short Chinese memory aid, can reference word roots",
  "synonyms": [{"word": "...", "note": "short English usage note", "noteZh": "short Chinese usage note"}],
  "antonyms": ["..."],
  "collocations": ["common phrase using the word", "..."],
  "etymology": {"originLang": "Latin|Greek|...", "parts": [{"seg": "...", "role": "前缀|词根|后缀", "meaning": "..."}], "story": "1-2 sentence Chinese explanation of the word's origin"}
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

        // Re-enrichment replaces old definitions/etymology rather than appending —
        // avoids duplicate rows on repeated runs.
        delDefs.run(row.id);
        delEty.run(row.id);
        insDef.run(row.id, w.wordType || row.word_type || "other", w.zh || "", null, w.exampleEn ?? null, w.exampleZh ?? null);
        if (w.etymology) insEty.run(row.id, JSON.stringify(w.etymology.parts ?? []), w.etymology.story ?? null, w.etymology.originLang ?? null);
        const enrichment = {
          definitions: [{ pos: w.wordType || row.word_type || "other", zh: w.zh || "", en: null, exampleEn: w.exampleEn, exampleZh: w.exampleZh }],
          synonyms: w.synonyms ?? [], antonyms: w.antonyms ?? [], collocations: w.collocations ?? [],
          derivatives: [], sentencePatterns: [], idioms: [], authorityQuotes: [],
          etymology: w.etymology, level: w.level ?? row.level ?? TARGET_LEVEL, mnemonic: w.mnemonic, complete: true,
        };
        updWordMeta.run(w.mnemonic ?? null, w.level ?? row.level ?? TARGET_LEVEL, row.id);
        updEnrich.run(JSON.stringify(enrichment), row.id);
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

  const system = `You write short original English essays (200-300 words) for a ${TARGET_LEVEL}-level Chinese English learner, in the style of a thoughtful tech/culture blog. You also extract learnable vocabulary and sentence patterns FROM YOUR OWN TEXT.

CRITICAL RULE: for every extracted item, "text" MUST be an EXACT, VERBATIM, case-sensitive substring that appears in your "content" field. This is non-negotiable — items whose text doesn't literally appear in the article will be discarded. For pattern items specifically: "text" is the literal sentence/clause instance from the article (NOT an abstracted skeleton like "not so much X as Y" — put that abstraction in "note" instead, prefixed with "句式骨架：").

Return ONLY JSON (no markdown fences) with this shape:
{
  "title": "...",
  "content": "200-300 word essay, 4-5 paragraphs",
  "items": [
    {"kind": "word", "text": "<verbatim word from content>", "zh": "...", "level": "${TARGET_LEVEL}", "note": "brief Chinese usage note", "context": "<verbatim sentence containing it>"},
    {"kind": "pattern", "text": "<verbatim clause/sentence from content>", "zh": "该句式含义", "level": "${TARGET_LEVEL}", "note": "句式骨架：<abstracted skeleton with X/Y>。<why it's useful>", "context": "<same verbatim text>"}
  ]
}
Include 4-6 word items and 2-3 pattern items.`;

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
      insItem.run(articleId, it.kind === "pattern" ? "pattern" : "word", it.text, it.zh || "", it.note || "", it.level || TARGET_LEVEL, it.context || it.text);
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

// ── patterns mode ───────────────────────────────────────────────────────
async function genPatterns() {
  const skeletons = listArg(args.skeletons, null);
  let added = 0, folded = 0, examplesAdded = 0;

  const system = `You are an English writing coach building a sentence-pattern library for a ${TARGET_LEVEL}-level Chinese English learner. ${skeletons ? "For each given skeleton, produce one entry." : `Invent ${COUNT} DISTINCT, genuinely useful ${TARGET_LEVEL}/C2 sentence patterns (with X/Y slots) spanning a mix of these functions: contrast, concession, emphasis, causal, condition, comparison, example.`}

Return ONLY a JSON array (no markdown fences) of objects with EXACTLY these keys:
{
  "pattern": "skeleton with X/Y slots, e.g. \\"not so much X as Y\\"",
  "zh": "concise Chinese meaning of the pattern",
  "tag": "one of: contrast, concession, emphasis, causal, condition, comparison, example, other",
  "level": "B2|C1|C2",
  "note": "one-line Chinese note on when to use it",
  "analysis": "full markdown analysis in Chinese with these exact headings: ## 结构拆解 / ## 语用功能 / ## 常见变体 / ## 例句 (3 examples) / ## 易错点",
  "examples": [{"sentence": "one natural example sentence using the pattern"}]
}`;

  const userPrompt = skeletons
    ? `Skeletons: ${skeletons.join(" | ")}`
    : `Generate ${COUNT} patterns now.`;

  const CHUNK = 8;
  const total = skeletons ? skeletons.length : COUNT;
  for (let i = 0; i < total; i += CHUNK) {
    const batchPrompt = skeletons ? `Skeletons: ${skeletons.slice(i, i + CHUNK).join(" | ")}` : userPrompt;
    const items = await callModelSafe(system, batchPrompt, "patterns");
    if (!Array.isArray(items)) continue;

    const tx = db.transaction((rows) => {
      for (const p of rows) {
        if (!p.pattern) continue;
        const pattern = String(p.pattern).trim();
        const tag = VALID_TAGS.includes(p.tag) ? p.tag : "other";
        const existing = findPattern.get(pattern);
        let patternId;
        if (existing) {
          patternId = existing.id;
          updPatternFields.run(existing.zh || p.zh || "", existing.note || p.note || "", existing.level || p.level || null, patternId);
          folded++;
        } else {
          const result = insPattern.run(pattern, p.zh || "", tag, p.level || TARGET_LEVEL, p.note || "", p.analysis || null);
          patternId = result.lastInsertRowid;
          added++;
        }
        for (const ex of p.examples ?? []) {
          const sentence = String(ex.sentence || "").trim();
          if (!sentence || findExample.get(patternId, sentence)) continue;
          insExample.run(patternId, sentence, "AI 生成示例", null);
          examplesAdded++;
        }
      }
    });
    tx(items);
    console.log(`[patterns] batch ${Math.floor(i / CHUNK) + 1}: +${items.length} candidates (${added} new, ${folded} folded into existing)`);
  }
  console.log(`[patterns] done: ${added} new patterns, ${folded} folded into existing, ${examplesAdded} examples added`);
}

// ── main ────────────────────────────────────────────────────────────────
const MODES = { words: genWords, articles: genArticles, patterns: genPatterns, documents: genDocuments, enrich: genEnrichExisting };

if (mode === "all") {
  await genWords();
  await genArticles();
  await genPatterns();
  await genDocuments();
  await genEnrichExisting();
} else if (MODES[mode]) {
  await MODES[mode]();
} else {
  console.error(`Usage: node server/generate-cli.mjs <words|articles|patterns|documents|enrich|all> [--topics "a,b"] [--count N] [--skeletons "a,b"] [--all] [--words "a,b"]`);
  process.exit(1);
}

db.close();
console.log("[generate] all done.");
