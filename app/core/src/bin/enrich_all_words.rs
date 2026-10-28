// Batch AI enrichment runner — analyzes every word that has no
// enrichment_text yet, against a local OpenAI-compatible endpoint, and writes
// results through the app's own storage path (same words/word_definitions
// updates the in-app "Enrich un-analyzed" button performs).
//
// Why a standalone binary and not the app's bulk button: this runs headless
// (no Electron), survives terminal closure via nohup, controls its own
// concurrency + retries, and reports progress per word. The App's own bulk
// enrich (useVocabBulkEnrich.ts) does the same thing but needs the GUI open
// for hours.
//
// Storage contract (mirrors db_add_word_enriched exactly):
//   words.enrichment_text = the markdown explanation
//   words.level           = CEFR level from the structured basic-info call
//   words.word_type       = part of speech, only if the word has none yet
//   word_definitions.zh   = short gloss, only if none exists yet
//   srs_records           = seeded (level 0, ease 2.5) if missing
//
// The two calls per word follow the app's own shape:
//   1. freeform explanation (DEFAULT_ENRICH_SYSTEM_PROMPT, no META line —
//      the app parses an optional leading META line; this script emits none,
//      which parseEnrichmentStream treats as pure body text. Same result.)
//   2. structured JSON basic info (BASIC_INFO_SYSTEM_PROMPT) for
//      word_type/level/zh — parsed with the same rules as basicInfo.ts
//      (brace-scan + tolerate surrounding noise).
//
// Run:
//   cargo run --release --bin enrich_all_words -- \
//       --api-base https://fos-exp-ai.corp.fortinet.com/v1 \
//       --model deepseek-v4.1-flash \
//       --api-key <key> \
//       [--concurrency 16] [--limit N] [--target-level C1]
//
// Resumable: re-running skips everything that already has enrichment_text.

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tanwords_lib::db::connection::{open, DbProfile};
use tanwords_lib::db::{self, rows::Value};

// ── Prompts: verbatim copies of the app's (app/src/providers/base.ts) ───────

const ENRICH_SYSTEM_PROMPT: &str = "你是一位资深词汇讲解者，面向 CEFR C1/C2 中文母语学习者，用中文讲解英文单词。

正文完全自由，不设固定格式：根据这个词值得讲的内容自行组织（核心释义、常见用法、易混淆点、词源、记忆方法等），该长则长、该短则短，无需覆盖每一类内容。但以下两点是硬性要求：

1. **例句要多、要覆盖不同场景**：至少给 4-6 条例句，覆盖这个词的不同词义/词性（如果有多个）、不同语域（日常口语、书面/学术、新闻财经等），不要只给一条敷衍了事。每条例句都要能体现这个词在真实语境里怎么用，而不是干巴巴的造句。
2. **常见用法要讲透**：搭配（collocations）、常见句型/介词搭配、近义词之间的细微差别、什么场合该用/不该用这个词——这些内容按需展开，不要一笔带过。

英文例句一律写成 markdown blockquote（>  开头），一条 blockquote 一句英文例句，可在同一 blockquote 内下一行附中文翻译。

真正关键的地方用 ==高亮== 标出（markdown 高亮语法，两个等号包裹）：比如核心释义里最能定性的那几个字、最值得记住的搭配、最容易踩的坑。只标最重要的，一段最多一两处，标太多等于没标。不要用 == 包裹整句话或整条例句。

直接从讲解正文开始，不要有任何与词义无关的内容：不要开场白（如\"当然可以\"\"我们来深度拆解一下\"之类的寒暄或过渡句），不要结尾互动语（如反问学习者最近的经历、邀请学习者造句、\"轮到你了\"之类的话术）。整段内容从头到尾都必须是词汇讲解本身。";

const BASIC_INFO_SYSTEM_PROMPT_TEMPLATE: &str = "你是一个词典数据生成器。给定一个英文单词或短语，输出它最常用、最权威的基本信息，用于学习卡片列表的摘要行。

只返回一个 JSON 对象，不要任何其他文字、不要代码块标记、不要解释：
{\"word_type\":\"<词性缩写，如 n/v/adj/adv/prep/conj/pron/phrase，多个词性用 / 分隔，如 n/v>\",\"level\":\"<CEFR等级，仅限 A1|A2|B1|B2|C1|C2>\",\"zh\":\"<10字以内、这个词最常用义项的中文短释义>\",\"scenes\":[\"<场景key>\"]}

只给这个词最常见、最核心的那个义项，不要罗列多个义项，不要输出别的字段。
\"scenes\" 是这个词最常出现的 0–4 个交际场景，只能从下面的场景列表里选，key 必须完全一致，没有合适的就给空数组：
{SCENE_KEYS}";

/// The instantiated prompt — the registry (answer key) baked in. Mirrors
/// buildBasicInfoSystemPrompt() in app/src/providers/base.ts.
fn basic_info_system_prompt() -> String {
    BASIC_INFO_SYSTEM_PROMPT_TEMPLATE.replace(
        "{SCENE_KEYS}",
        &tanwords_lib::db::scenarios::scenario_seed_keys().join("、"),
    )
}

#[derive(Deserialize, Default, Clone)]
struct BasicInfo {
    #[serde(rename = "word_type", default)]
    word_type: Option<String>,
    #[serde(default)]
    level: Option<String>,
    #[serde(default)]
    zh: Option<String>,
    /// Scenario keys from the model's "scenes" — validated against the
    /// registry in persist() (unknown keys dropped there, same as TS).
    #[serde(default)]
    scenes: Option<Vec<String>>,
}

/// Same parsing rules as the app's basicInfo.ts: find the first '{', take to
/// the matching '}' (tolerating trailing junk), repair nothing but fall back
/// to empty on garbage.
fn parse_basic_info(raw: &str) -> BasicInfo {
    let start = match raw.find('{') {
        Some(i) => i,
        None => return BasicInfo::default(),
    };
    // naive brace matching — the models emit well-formed JSON in practice
    let mut depth = 0i32;
    let mut end = None;
    for (i, c) in raw[start..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(start + i + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let slice = &raw[start..end.unwrap_or(raw.len())];
    match serde_json::from_str(slice) {
        Ok(v) => v,
        Err(_) => BasicInfo::default(),
    }
}

/// Strip <think> blocks some reasoning models emit inline.
fn strip_think(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut s = raw;
    let open = "<think>";
    let close = "</think>";
    // remove closed think blocks, then any trailing unterminated one
    while let Some(a) = s.find(open) {
        if let Some(b) = s.find(close) {
            if b > a {
                out.push_str(&s[..a]);
                s = &s[b + close.len()..];
                continue;
            }
        }
        out.push_str(&s[..a]);
        break;
    }
    out.push_str(s);
    // unterminated thinking block: cut to end
    if let Some(a) = out.find(open) {
        out.truncate(a);
    }
    out.trim().to_string()
}

struct Ctx {
    client: reqwest::Client,
    api_base: String,
    model: String,
    api_key: String,
    target_level: String,
    conn: tanwords_lib::db::rows::Conn,
    ok: AtomicI64,
    fail: AtomicI64,
    done: AtomicI64,
    retries_done: AtomicU64,
    rate_limited: AtomicBool,
}

impl Ctx {
    /// One non-streaming chat completion. Returns the concatenated text.
    async fn chat(&self, system: &str, user: &str) -> Result<String, String> {
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            // stream:false — a batch runner doesn't need token streaming
            "stream": false,
            "temperature": 0.7,
        });
        let mut attempt = 0;
        loop {
            let resp = self
                .client
                .post(format!("{}/chat/completions", self.api_base))
                .bearer_auth(&self.api_key)
                .json(&body)
                .timeout(Duration::from_secs(120))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status();
            if status.as_u16() == 429 || status.is_server_error() {
                attempt += 1;
                if attempt > 6 {
                    return Err(format!("giving up after {attempt} retries (HTTP {})", status));
                }
                self.rate_limited.store(true, Ordering::Relaxed);
                // exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s
                let wait = Duration::from_secs(1u64 << attempt.min(6));
                eprintln!(
                    "  [retry {}] HTTP {} — backing off {:?}",
                    attempt, status, wait
                );
                tokio::time::sleep(wait).await;
                continue;
            }
            if !status.is_success() {
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("HTTP {}: {}", status, txt.chars().take(300).collect::<String>()));
            }
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            return json["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "no content in response".to_string());
        }
    }

    /// The freeform explanation for one word.
    async fn enrich_word(&self, word: &str) -> Result<String, String> {
        let user = format!("请讲解这个英文单词：\"{word}\"（学习者目标水平：{}）", self.target_level);
        let raw = self.chat(ENRICH_SYSTEM_PROMPT, &user).await?;
        let text = strip_think(&raw);
        if text.len() < 60 {
            return Err(format!("suspiciously short explanation ({} bytes)", text.len()));
        }
        Ok(text)
    }

    /// The structured basic info for one word.
    async fn basic_info(&self, word: &str) -> BasicInfo {
        let user = format!("单词或短语：\"{word}\"（学习者目标水平：{}）", self.target_level);
        // This call is best-effort like in the app: failures just yield an
        // empty struct, the explanation is what must succeed.
        match self.chat(&basic_info_system_prompt(), &user).await {
            Ok(raw) => parse_basic_info(&raw),
            Err(e) => {
                eprintln!("  [basic-info] {word}: {e}");
                BasicInfo::default()
            }
        }
    }

    /// Write one word's results — mirrors db_add_word_enriched's UPDATE tail
    /// (level/word_type only when missing, gloss only when missing, srs seed).
    async fn persist(&self, word_id: i64, text: &str, info: &BasicInfo) -> Result<(), String> {
        let tx = self.conn.transaction().await.map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE words SET enrichment_text = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            vec![Value::from(text.to_string()), Value::from(word_id)],
        )
        .await
        .map_err(|e| e.to_string())?;
        if let Some(level) = &info.level {
            tx.execute(
                "UPDATE words SET level = COALESCE(level, ?1) WHERE id = ?2",
                vec![Value::from(level.clone()), Value::from(word_id)],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        if let Some(wt) = &info.word_type {
            tx.execute(
                "UPDATE words SET word_type = COALESCE(word_type, ?1) WHERE id = ?2",
                vec![Value::from(wt.clone()), Value::from(word_id)],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        // short gloss: only when no definition row carries one yet
        let existing: Option<String> = db::fetch_optional(
            &tx,
            "SELECT zh FROM word_definitions WHERE word_id = ?1 ORDER BY sort_order LIMIT 1",
            vec![Value::from(word_id)],
            |r| r.get(0),
        )
        .await?;
        let needs_gloss = existing.as_deref().map(|z| z.trim().is_empty()).unwrap_or(true);
        if needs_gloss {
            let gloss = info.zh.clone().unwrap_or_default();
            if !gloss.trim().is_empty() {
                match existing {
                    Some(_) => {
                        tx.execute(
                            "UPDATE word_definitions SET zh = ?1 WHERE word_id = ?2 AND (zh IS NULL OR TRIM(zh) = '')",
                            vec![Value::from(gloss), Value::from(word_id)],
                        )
                        .await
                        .map_err(|e| e.to_string())?;
                    }
                    None => {
                        tx.execute(
                            "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES (?1, 'other', ?2, 0)",
                            vec![Value::from(word_id), Value::from(gloss)],
                        )
                        .await
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        tx.execute(
            "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'word', 0, 2.5)",
            vec![Value::from(word_id)],
        )
        .await
        .map_err(|e| e.to_string())?;
        // Scene links — same contract as db_add_word_enriched: validate
        // against the registry, INSERT OR IGNORE (never over existing rows,
        // so tombstones and manual links survive), source='enrichment'.
        if let Some(scenes) = &info.scenes {
            for key in scenes {
                let sid: Option<i64> = db::fetch_optional(
                    &tx,
                    "SELECT id FROM scenarios WHERE scenario_key = ?1",
                    vec![Value::from(key.clone())],
                    |r| r.get(0),
                )
                .await?;
                if let Some(sid) = sid {
                    tanwords_lib::db::scenarios::link_word_scenario(
                        &tx, word_id, sid, "enrichment", 0.85,
                    )
                    .await?;
                }
            }
        }
        tx.commit().await.map_err(|e| e.to_string())
    }
}

fn arg_or(args: &[String], flag: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let api_base = arg_or(&args, "--api-base", "https://fos-exp-ai.corp.fortinet.com/v1");
    let model = arg_or(&args, "--model", "deepseek-v4.1-flash");
    let api_key = arg_or(&args, "--api-key", "");
    let concurrency: usize = arg_or(&args, "--concurrency", "16").parse().unwrap_or(16);
    let limit: i64 = arg_or(&args, "--limit", "0").parse().unwrap_or(0);
    let target_level = arg_or(&args, "--target-level", "C1");
    if api_key.is_empty() {
        return Err("--api-key is required".into());
    }

    // open the ACTIVE profile (remote Postgres today)
    let cfg_path = tanwords_lib::app_data_dir().join("app_config.json");
    let cfg: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&cfg_path).map_err(|e| format!("read {cfg_path:?}: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let profile: DbProfile =
        serde_json::from_value(cfg["db_profile"].clone()).map_err(|e| e.to_string())?;
    let db = open(&profile, None).await?;
    let conn = db.conn();
    println!("db: {:?} (backend {:?})", profile.path(), db.backend());

    // every word with no enrichment yet — id + word only
    let mut sql = "SELECT id, word FROM words WHERE enrichment_text IS NULL ORDER BY id".to_string();
    if limit > 0 {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    let todo: Vec<(i64, String)> = db::fetch_all(&conn, &sql, (), |r| {
        Ok((r.get::<i64>(0)?, r.get::<String>(1)?))
    })
    .await?;
    let total = todo.len();
    println!("words to analyze: {total} (concurrency {concurrency}, model {model})");
    if total == 0 {
        return Ok(());
    }

    let ctx = Arc::new(Ctx {
        client: reqwest::Client::new(),
        api_base,
        model,
        api_key,
        target_level,
        conn: conn.clone_handle(),
        ok: AtomicI64::new(0),
        fail: AtomicI64::new(0),
        done: AtomicI64::new(0),
        retries_done: AtomicU64::new(0),
        rate_limited: AtomicBool::new(false),
    });

    let started = Instant::now();
    let next = std::sync::atomic::AtomicUsize::new(0);

    // progress reporter
    let prog = tokio::spawn({
        let ctx = ctx.clone();
        let started = started;
        async move {
            loop {
                tokio::time::sleep(Duration::from_secs(15)).await;
                let done = ctx.done.load(Ordering::Relaxed);
                let ok = ctx.ok.load(Ordering::Relaxed);
                let fail = ctx.fail.load(Ordering::Relaxed);
                let el = started.elapsed().as_secs_f64();
                let rate = if done > 0 { done as f64 / el } else { 0.0 };
                let eta = if rate > 0.0 {
                    format!("{:.0}m", ((total as i64 - done) as f64 / rate) / 60.0)
                } else {
                    "?".into()
                };
                println!(
                    "[progress] {}/{} done (ok {ok}, fail {fail}) — {rate:.2}/s, ETA {eta}",
                    done, total
                );
                let _ = std::io::stdout().flush();
            }
        }
    });

    // worker pool with a shared cursor
    let workers = (0..concurrency).map(|_| {
        let ctx = ctx.clone();
        let todo = &todo;
        let next = &next;
        async move {
            loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= todo.len() {
                    break;
                }
                let (word_id, word) = &todo[i];
                // retry the whole word up to 3 times (each chat() already
                // retries 429/5xx internally with backoff)
                let mut attempt = 0;
                loop {
                    match ctx.enrich_word(word).await {
                        Ok(text) => {
                            let info = ctx.basic_info(word).await;
                            match ctx.persist(*word_id, &text, &info).await {
                                Ok(()) => {
                                    ctx.ok.fetch_add(1, Ordering::Relaxed);
                                }
                                Err(e) => {
                                    eprintln!("  [persist] {word}: {e}");
                                    ctx.fail.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                            break;
                        }
                        Err(e) => {
                            attempt += 1;
                            if attempt >= 3 {
                                eprintln!("  [FAIL] {word}: {e}");
                                ctx.fail.fetch_add(1, Ordering::Relaxed);
                                break;
                            }
                            eprintln!("  [attempt {attempt}] {word}: {e} — retrying");
                            tokio::time::sleep(Duration::from_secs(3)).await;
                        }
                    }
                }
                ctx.done.fetch_add(1, Ordering::Relaxed);
            }
        }
    });
    futures_util::future::join_all(workers).await;
    prog.abort();

    let ok = ctx.ok.load(Ordering::Relaxed);
    let fail = ctx.fail.load(Ordering::Relaxed);
    println!(
        "\nFINISHED in {:.0}s: {} ok, {} failed, {} total",
        started.elapsed().as_secs_f64(),
        ok,
        fail,
        total
    );
    if fail > 0 {
        eprintln!("re-run to retry only the failures (already-analyzed words are skipped)");
    }
    Ok(())
}
