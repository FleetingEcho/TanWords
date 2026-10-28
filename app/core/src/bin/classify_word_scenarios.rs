// Word→scenario backfill runner — makes scene coverage measurable and
// improvable without spending enrichment tokens (plan-scene-learning.md §6).
//
// Three passes, cheapest first; only the third spends tokens:
//
//   1. --derive        Zero-AI pass over existing data:
//                       a) scene-lab vocabulary (scene_vocabulary × the
//                          scene's mapped taxonomy key)      → 'scene-lab'
//                       b) knowledge-map situation nodes and
//                          their word children               → 'knowledge-map'
//                       c) words.tags that equal a scenario
//                          key or name (case-insensitive)     → 'tag-import'
//   2. --ai            A cheap classification call per UNLINKED word asking
//                      for 0–4 registry keys (the answer key is the seeded
//                      taxonomy, so the model can't invent keys) → 'backfill'.
//                      ~10× cheaper than a full enrichment: one short JSON
//                      reply, no markdown body.
//   3. default: run 1 then 2 in order.
//
// Every pass is INSERT OR IGNORE on (word_id, scenario_id) and skips rows
// where a link already exists — including rejected tombstones, which is
// what keeps a user's deletion permanent across re-runs.
//
// Resumable: re-running only ever touches words with zero non-rejected
// links, so the run converges to a no-op.
//
// Run:
//   cargo run --release --bin classify_word_scenarios -- \
//       [--api-base …] [--model …] [--api-key <key>]
//       [--concurrency 16] [--limit N] [--derive] [--ai] [--dry-run]
//
// --api-key is only required for the AI pass.

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tanwords_lib::db::connection::{open, DbProfile};
use tanwords_lib::db::{self, rows::Value, scenarios::scenario_seed_keys};

/// The classification prompt: a strict JSON reply over a fixed answer key.
/// Mirrors BASIC_INFO_SYSTEM_PROMPT's scenes contract so a provider already
/// tuned for the enrichment prompt behaves identically here.
const CLASSIFY_SYSTEM_PROMPT_TEMPLATE: &str = "你是一个词汇场景分类器。给定一个英文单词或短语，判断它最常出现在哪些交际场景里。

只返回一个 JSON 对象，不要任何其他文字、不要代码块标记、不要解释：
{\"scenes\":[\"<场景key>\"]}

\"scenes\" 是这个词最常出现的 0–4 个交际场景，只能从下面的场景列表里选，key 必须完全一致，没有合适的就给空数组：
{SCENE_KEYS}";

fn classify_system_prompt() -> String {
    CLASSIFY_SYSTEM_PROMPT_TEMPLATE.replace("{SCENE_KEYS}", &scenario_seed_keys().join("、"))
}

#[derive(Deserialize, Default)]
struct ClassifyReply {
    #[serde(default)]
    scenes: Option<Vec<String>>,
}

fn parse_classify(raw: &str) -> ClassifyReply {
    let start = match raw.find('{') {
        Some(i) => i,
        None => return ClassifyReply::default(),
    };
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
    serde_json::from_str(slice).unwrap_or_default()
}

fn arg_or(args: &[String], flag: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

struct Ctx {
    client: reqwest::Client,
    api_base: String,
    model: String,
    api_key: String,
    conn: tanwords_lib::db::Conn,
    ok: AtomicI64,
    fail: AtomicI64,
    done: AtomicI64,
    retries_done: AtomicU64,
    rate_limited: AtomicBool,
}

impl Ctx {
    /// One non-streaming chat call with 429/5xx backoff — the same retry
    /// shape enrich_all_words uses.
    async fn chat(&self, system: &str, user: &str) -> Result<String, String> {
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            "stream": false,
            "temperature": 0.3,
        });
        let mut attempt = 0;
        loop {
            let resp = self
                .client
                .post(format!("{}/chat/completions", self.api_base))
                .bearer_auth(&self.api_key)
                .json(&body)
                .timeout(Duration::from_secs(60))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status();
            if status.as_u16() == 429 || status.is_server_error() {
                attempt += 1;
                if attempt > 6 {
                    return Err(format!("giving up after {attempt} retries (HTTP {status})"));
                }
                self.rate_limited.store(true, Ordering::Relaxed);
                let wait = Duration::from_secs(1u64 << attempt.min(6));
                eprintln!("  [retry {attempt}] HTTP {status} — backing off {wait:?}");
                tokio::time::sleep(wait).await;
                continue;
            }
            if !status.is_success() {
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!(
                    "HTTP {status}: {}",
                    txt.chars().take(300).collect::<String>()
                ));
            }
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            return json["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "no content in response".to_string());
        }
    }
}

/// One AI classification per word, persisted with source='backfill'.
async fn classify_word(
    ctx: &Ctx,
    word_id: i64,
    word: &str,
    dry_run: bool,
) -> Result<usize, String> {
    let user = format!("单词或短语：\"{word}\"");
    let raw = ctx.chat(&classify_system_prompt(), &user).await?;
    let reply = parse_classify(&raw);
    let keys = reply.scenes.unwrap_or_default();
    if keys.is_empty() {
        return Ok(0);
    }
    let tx = ctx.conn.transaction().await.map_err(|e| e.to_string())?;
    let mut linked = 0usize;
    for key in keys {
        let sid: Option<i64> = db::fetch_optional(
            &tx,
            "SELECT id FROM scenarios WHERE scenario_key = ?1",
            vec![Value::from(key.clone())],
            |r| r.get(0),
        )
        .await?;
        if let Some(sid) = sid {
            if !dry_run {
                tanwords_lib::db::scenarios::link_word_scenario(
                    &tx, word_id, sid, "backfill", 0.6,
                )
                .await?;
            }
            linked += 1;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(linked)
}

/// Scene-lab (dormant) scene title → taxonomy scenario key. Checked in and
/// tiny by design (plan §6.2): scene-lab has a handful of user-generated
/// scenes; unmapped titles are skipped rather than guessed. Extend this
/// table when reviving scene-lab, not the SQL.
fn scene_lab_title_to_key(title: &str) -> Option<&'static str> {
    let t = title.trim().to_lowercase();
    Some(match t.as_str() {
        "kitchen" | "厨房" => "housing.home",
        "cafe" | "coffee shop" | "咖啡店" => "dining.cafe",
        "restaurant" | "餐厅" => "dining.restaurant",
        "supermarket" | "grocery" | "超市" => "shopping.supermarket",
        "airport" | "机场" => "travel.airport",
        "office" | "办公室" => "work.office",
        "doctor" | "clinic" | "诊所" | "医院" => "health.doctor",
        _ => return None,
    })
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let api_base = arg_or(&args, "--api-base", "https://fos-exp-ai.corp.fortinet.com/v1");
    let model = arg_or(&args, "--model", "deepseek-v4.1-flash");
    let api_key = arg_or(&args, "--api-key", "");
    let concurrency: usize = arg_or(&args, "--concurrency", "16").parse().unwrap_or(16);
    let limit: i64 = arg_or(&args, "--limit", "0").parse().unwrap_or(0);
    let dry_run = has_flag(&args, "--dry-run");
    let want_derive = has_flag(&args, "--derive");
    let want_ai = has_flag(&args, "--ai");
    // default: both passes
    let (do_derive, do_ai) = if !want_derive && !want_ai {
        (true, true)
    } else {
        (want_derive, want_ai)
    };
    if do_ai && api_key.is_empty() {
        return Err("--api-key is required for the AI pass".into());
    }

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

    // ── Pass 1: derivations (zero AI calls) ──────────────────────────────
    if do_derive {
        // (a) scene-lab vocabulary. The dormant scene-lab keeps its own
        // scene/word tables; the checked-in name mapping below decides which
        // scene's words inherit which scenario. A scene with no mapping is
        // skipped, not guessed. Scene-lab's `scenes.title` is the join key.
        let mut lab_rows: Vec<(i64, i64)> = Vec::new();
        {
            let pairs: Result<Vec<(i64, String)>, String> = db::fetch_all(
                &conn,
                "SELECT DISTINCT sv.word_id, sl.title
                 FROM scene_vocabulary sv
                 JOIN scene_lessons sl_ ON sl_.id = sv.lesson_id
                 JOIN scenes sl ON sl.id = sl_.scene_id
                 WHERE sv.word_id IS NOT NULL",
                (),
                |r| Ok((r.get::<i64>(0)?, r.get::<String>(1)?)),
            )
            .await;
            if let Ok(pairs) = pairs {
                for (word_id, title) in pairs {
                    if let Some(key) = scene_lab_title_to_key(&title) {
                        let sid: Option<i64> = db::fetch_optional(
                            &conn,
                            "SELECT id FROM scenarios WHERE scenario_key = ?1",
                            vec![Value::from(key.to_string())],
                            |r| r.get(0),
                        )
                        .await?;
                        if let Some(sid) = sid {
                            lab_rows.push((word_id, sid));
                        }
                    }
                }
            }
        }
        if !lab_rows.is_empty() {
            let tx = conn.transaction().await.map_err(|e| e.to_string())?;
            for (word_id, scenario_id) in &lab_rows {
                tanwords_lib::db::scenarios::link_word_scenario(
                    &tx, *word_id, *scenario_id, "scene-lab", 1.0,
                )
                .await?;
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        println!(
            "derive: scene-lab vocabulary → {} links",
            lab_rows.len()
        );

        // (b) knowledge-map situation nodes: each 'situation' node's word
        // children inherit the node's mapped scenario (key stored in the
        // node's title match or a dedicated mapping — we match by node name
        // against the registry's name_en/name_zh).
        let derived_map: Result<Vec<(i64, i64)>, String> = db::fetch_all(
            &conn,
            "SELECT DISTINCT wc.word_id, sc.id
             FROM knowledge_nodes kn
             JOIN scenarios sc ON (
                   LOWER(TRIM(kn.title)) = LOWER(sc.name_en)
                OR TRIM(kn.title) = sc.name_zh
                OR kn.meta ->> 'scenario_key' = sc.scenario_key)
             JOIN knowledge_nodes wc ON wc.parent_id = kn.id
             WHERE kn.kind = 'situation' AND wc.word_id IS NOT NULL",
            (),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .await;
        let map_rows = match derived_map {
            Ok(rows) => rows,
            Err(_) => Vec::new(),
        };
        if !map_rows.is_empty() {
            let tx = conn.transaction().await.map_err(|e| e.to_string())?;
            for (word_id, scenario_id) in &map_rows {
                tanwords_lib::db::scenarios::link_word_scenario(
                    &tx, *word_id, *scenario_id, "knowledge-map", 0.95,
                )
                .await?;
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        println!("derive: knowledge-map situations → {} links", map_rows.len());

        // (c) tags that exactly equal a scenario key or name.
        let registry: Vec<(i64, String, String, String)> = db::fetch_all(
            &conn,
            "SELECT id, scenario_key, LOWER(name_en), name_zh FROM scenarios",
            (),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .await?;
        let tagged: Vec<(i64, String)> = db::fetch_all(
            &conn,
            "SELECT id, tags FROM words WHERE tags IS NOT NULL AND TRIM(tags) != ''",
            (),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .await?;
        let mut tag_links = 0usize;
        {
            let tx = conn.transaction().await.map_err(|e| e.to_string())?;
            for (word_id, tags_json) in &tagged {
                // tags is a JSON array of strings; probe membership the
                // same forgiving way the words filter does (strip, lowercase).
                let tags: Vec<String> = serde_json::from_str(tags_json).unwrap_or_default();
                for t in tags {
                    let tl = t.trim().to_lowercase();
                    for (sid, key, name_en_l, name_zh) in &registry {
                        if tl == key.as_str() || tl == *name_en_l || t.trim() == *name_zh {
                            tanwords_lib::db::scenarios::link_word_scenario(
                                &tx, *word_id, *sid, "tag-import", 0.8,
                            )
                            .await?;
                            tag_links += 1;
                        }
                    }
                }
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        println!("derive: tag matches → {tag_links} links");
    }

    if !do_ai {
        return Ok(());
    }

    // ── Pass 2: AI classification over UNLINKED words ───────────────────
    // A word qualifies when it has no non-rejected link at all — words with
    // any effective link are assumed covered (the goal is the untagged_words
    // metric going down, not maximal per-scene recall).
    let mut sql = "SELECT w.id, w.word
         FROM words w
         WHERE NOT EXISTS (
             SELECT 1 FROM word_scenarios ws WHERE ws.word_id = w.id AND ws.rejected = 0)
         ORDER BY w.id"
        .to_string();
    if limit > 0 {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    let todo: Vec<(i64, String)> = db::fetch_all(&conn, &sql, (), |r| {
        Ok((r.get::<i64>(0)?, r.get::<String>(1)?))
    })
    .await?;
    let total = todo.len();
    println!(
        "words to classify: {total} (concurrency {concurrency}, model {model}{})",
        if dry_run { ", DRY RUN" } else { "" }
    );
    if total == 0 {
        return Ok(());
    }

    let ctx = Arc::new(Ctx {
        client: reqwest::Client::new(),
        api_base,
        model,
        api_key,
        conn: conn.clone_handle(),
        ok: AtomicI64::new(0),
        fail: AtomicI64::new(0),
        done: AtomicI64::new(0),
        retries_done: AtomicU64::new(0),
        rate_limited: AtomicBool::new(false),
    });

    let started = Instant::now();
    let next = std::sync::atomic::AtomicUsize::new(0);
    let prog = tokio::spawn({
        let ctx = ctx.clone();
        let started = started;
        let total = total;
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
                    "[progress] {done}/{total} done (ok {ok}, fail {fail}) — {rate:.2}/s, ETA {eta}"
                );
                let _ = std::io::stdout().flush();
            }
        }
    });

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
                let mut attempt = 0;
                loop {
                    match classify_word(&ctx, *word_id, word, dry_run).await {
                        Ok(_linked) => {
                            ctx.ok.fetch_add(1, Ordering::Relaxed);
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
    let retries = ctx.retries_done.load(Ordering::Relaxed);
    println!(
        "classified {ok} words ({fail} failed, {retries} retries) in {:.0}s",
        started.elapsed().as_secs_f64()
    );
    Ok(())
}
