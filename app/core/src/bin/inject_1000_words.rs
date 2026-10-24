// One-shot import: inject the words from ~/Downloads/1000-words.csv into the
// ACTIVE database profile (read from app_config.json — today the remote
// Postgres). Uses the app's own `db::connection::open` so every write lands
// through the same SQL translation, schema init, and timestamp format the
// running app uses.
//
// Data mapping (CSV → words tables):
//   单词        → words.word (lowercased, the app's convention)
//   词性·释义   → split "art. 这个、这些" → word_definitions.pos ("art") + zh
//   美式音标    → word_phonetics (locale 'en-US')
//   例句/译文   → word_definitions.example_en / example_zh
//   分类        → words.tags
//
// Existing words are left untouched (ON CONFLICT DO NOTHING); the CSV's two
// case-duplicates (may/May, march/March) collapse to their lowercase form.
//
// Hand-rolled RFC-4180 parsing (the crate has no `csv` dependency to pull
// in): quote-aware field splitting, "" escapes, UTF-8 throughout.
//
// Run: cargo run --release --bin inject_1000_words [path-to-csv]

use std::io::{BufRead, BufReader};
use std::time::Instant;
use tanwords_lib::db::connection::{open, DbProfile};
use tanwords_lib::db::{self, rows::Value};

/// Split one CSV line into fields: respects `"…"` quoted fields with `""`
/// escapes and embedded commas. The file has no multi-line quoted fields
/// (verified: every row parses to exactly 8 fields).
fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if matches!(chars.peek(), Some('"')) {
                    chars.next();
                    cur.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            fields.push(cur.clone());
            cur.clear();
        } else {
            cur.push(c);
        }
    }
    fields.push(cur);
    fields
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let csv_path = std::env::args().nth(1).unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join("Downloads/1000-words.csv").to_string_lossy().into_owned())
            .expect("no HOME")
    });

    // 1) Parse CSV (UTF-8 BOM handled) → rows
    let f = std::fs::File::open(&csv_path).map_err(|e| format!("open {csv_path}: {e}"))?;
    let reader = BufReader::new(f);
    let mut lines = reader.lines();
    let header_line = lines.next().ok_or("empty file")?.map_err(|e| e.to_string())?;
    let header_line = header_line.trim_start_matches('\u{feff}');
    let hdrs = split_csv_line(header_line);
    let idx = |name: &str| {
        hdrs.iter()
            .position(|h| h == name)
            .ok_or_else(|| format!("CSV missing column {name} (has: {hdrs:?})"))
    };
    let (c_word, c_gloss, c_ipa, c_ex, c_exzh, c_cat) = (
        idx("单词")?,
        idx("词性·释义")?,
        idx("美式音标")?,
        idx("例句")?,
        idx("译文／提示")?,
        idx("分类")?,
    );

    struct Row {
        word: String,
        word_type: Option<String>,
        zh: String,
        ipa: String,
        example_en: String,
        example_zh: String,
        tag: String,
    }
    let mut rows: Vec<Row> = Vec::new();
    for (n, line) in lines.enumerate() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let cols = split_csv_line(&line);
        let get = |i: usize| cols.get(i).cloned().unwrap_or_default();
        // "art. 这个、这些" → pos "art", zh "这个、这些". Some rows have no
        // matching ". " (rare 'modal v.' shapes) — fall back to pos "other".
        let gloss = get(c_gloss);
        let (wt, zh) = match gloss.find(". ") {
            Some(i) => (gloss[..i].trim().to_string(), gloss[i + 2..].trim().to_string()),
            None => (String::new(), gloss.trim().to_string()),
        };
        let word = get(c_word).trim().to_lowercase();
        if word.is_empty() || zh.is_empty() {
            eprintln!("line {}: empty word or gloss, skipped", n + 2);
            continue;
        }
        rows.push(Row {
            word,
            word_type: if wt.is_empty() { None } else { Some(wt) },
            zh,
            ipa: get(c_ipa).trim().replace('—', ""),
            example_en: get(c_ex).trim().to_string(),
            example_zh: get(c_exzh).trim().to_string(),
            tag: get(c_cat).trim().to_string(),
        });
    }
    println!("parsed {} words from {}", rows.len(), csv_path);

    // 2) Open the ACTIVE profile (Postgres today)
    let cfg_path = tanwords_lib::app_data_dir().join("app_config.json");
    let cfg: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&cfg_path).map_err(|e| format!("read {cfg_path:?}: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let profile: DbProfile =
        serde_json::from_value(cfg["db_profile"].clone()).map_err(|e| e.to_string())?;
    let started = Instant::now();
    let db = open(&profile, None).await?;
    println!("connected in {:?}", started.elapsed());
    let conn = db.conn();

    // 3) Inject inside one transaction: INSERT ... ON CONFLICT DO NOTHING
    //    keeps existing words (from earlier use / AI lookups) untouched.
    let tx = conn.transaction().await.map_err(|e| e.to_string())?;
    let mut added = 0i64;
    let mut skipped = 0i64;

    for r in &rows {
        let inserted = db::fetch_optional(
            &tx,
            "INSERT INTO words (word, word_type, source, tags) VALUES (?1, ?2, 'import', ?3)
             ON CONFLICT(word) DO NOTHING RETURNING id",
            vec![
                Value::from(r.word.as_str()),
                Value::from(r.word_type.as_deref()),
                Value::from(format!("[\"{}\"]", r.tag)),
            ],
            |row| row.get::<i64>(0),
        )
        .await?;
        let Some(word_id) = inserted else {
            skipped += 1;
            continue;
        };
        added += 1;
        // Definition (pos + zh + example pair)
        tx.execute(
            "INSERT INTO word_definitions (word_id, pos, zh, example_en, example_zh, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            vec![
                Value::from(word_id),
                Value::from(r.word_type.as_deref().unwrap_or("other")),
                Value::from(r.zh.as_str()),
                Value::from(r.example_en.as_str()),
                Value::from(r.example_zh.as_str()),
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        // American IPA
        if !r.ipa.is_empty() {
            tx.execute(
                "INSERT INTO word_phonetics (word_id, locale, ipa) VALUES (?1, 'en-US', ?2)",
                vec![Value::from(word_id), Value::from(r.ipa.as_str())],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    println!(
        "DONE in {:?}: added {}, skipped {} (already present)",
        started.elapsed(),
        added,
        skipped
    );
    Ok(())
}
