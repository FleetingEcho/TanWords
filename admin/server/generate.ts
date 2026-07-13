import { Hono } from "hono";
import { db } from "./db.js";

export const generate = new Hono();

interface GenConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

interface GeneratedWord {
  word: string;
  zh: string;
  word_type: string;
  level: string;
  example_en?: string;
  example_zh?: string;
  mnemonic?: string;
}

const SYSTEM_PROMPT = `You are a lexicographer building a vocabulary database for a C1-level English learner (senior software engineer). For each input word, return a JSON object with:
- word: the word, lowercase, dictionary form
- zh: concise Chinese meaning
- word_type: one of n, v, adj, adv, prep, phrase
- level: CEFR level estimate (B1-C2)
- example_en: one natural example sentence
- example_zh: its Chinese translation
- mnemonic: a short memory aid in Chinese (optional)

Return ONLY a JSON array of these objects, one per input word, no prose, no markdown fences.`;

async function callModel(cfg: GenConfig, words: string[]): Promise<GeneratedWord[]> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Words: ${words.join(", ")}` },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`Model request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "[]";
  const content = stripThinkTags(raw);
  const jsonText = content.trim().replace(/^```json\n?/, "").replace(/```$/, "");
  return JSON.parse(jsonText);
}

// Local reasoning models (DeepSeek-R1, QwQ, etc.) prepend a <think>...</think> block; strip it before parsing.
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

// POST /api/generate/preview — words + model config → generated rows, NOT written to DB yet
generate.post("/preview", async (c) => {
  const { words, config } = await c.req.json<{ words: string[]; config: GenConfig }>();

  const existing = new Set(
    (db.prepare("SELECT word FROM words").all() as { word: string }[]).map((r) => r.word.toLowerCase())
  );
  const known = new Set(
    (db.prepare("SELECT word FROM user_known_words").all() as { word: string }[]).map((r) =>
      r.word.toLowerCase()
    )
  );

  const toGenerate = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].filter(
    (w) => !existing.has(w) && !known.has(w)
  );
  const skipped = words.length - toGenerate.length;

  if (toGenerate.length === 0) {
    return c.json({ items: [], skipped });
  }

  // Batch in chunks of 20 to keep prompts small and errors isolated
  const CHUNK = 20;
  const items: GeneratedWord[] = [];
  for (let i = 0; i < toGenerate.length; i += CHUNK) {
    const chunk = toGenerate.slice(i, i + CHUNK);
    try {
      const result = await callModel(config, chunk);
      items.push(...result);
    } catch (e) {
      console.error("[generate] chunk failed:", e);
    }
  }

  return c.json({ items, skipped });
});

/** Builds a minimal freeform words.enrichment_text body from this quick-add
 *  tool's lightweight output — the app's word detail view reads this column
 *  as the primary explanation, so leaving it blank shows an empty detail
 *  panel. Not as rich as the CLI's `enrich` mode; use that for real depth. */
function buildEnrichmentText(row: GeneratedWord): string {
  const lines = [`**${row.zh}**`];
  if (row.mnemonic) lines.push("", row.mnemonic);
  if (row.example_en) {
    lines.push("", `> ${row.example_en}`);
    if (row.example_zh) lines[lines.length - 1] += `\n> ${row.example_zh}`;
  }
  return lines.join("\n");
}

// POST /api/generate/commit — accepted rows → written to words + word_definitions
generate.post("/commit", async (c) => {
  const { items, source } = await c.req.json<{ items: GeneratedWord[]; source?: string }>();

  const insertWord = db.prepare(
    "INSERT OR IGNORE INTO words (word, word_type, level, word_freq, source) VALUES (?, ?, ?, 1, ?)"
  );
  const insertDef = db.prepare(
    "INSERT INTO word_definitions (word_id, pos, zh, example_en, example_zh, sort_order) VALUES (?, ?, ?, ?, ?, 0)"
  );
  const insertEnrichmentText = db.prepare("UPDATE words SET enrichment_text = ? WHERE id = ?");
  const findId = db.prepare("SELECT id FROM words WHERE word = ?");

  const tx = db.transaction((rows: GeneratedWord[]) => {
    let added = 0;
    let skipped = 0;
    for (const row of rows) {
      const word = row.word.trim().toLowerCase();
      if (!word) continue;
      const result = insertWord.run(word, row.word_type ?? null, row.level ?? null, source ?? "batch");
      if (result.changes === 0) {
        skipped++;
        continue;
      }
      added++;
      const { id } = findId.get(word) as { id: number };
      insertDef.run(id, row.word_type || "other", row.zh, row.example_en ?? null, row.example_zh ?? null);
      insertEnrichmentText.run(buildEnrichmentText(row), id);
    }
    return { added, skipped };
  });

  const result = tx(items);
  return c.json(result);
});
