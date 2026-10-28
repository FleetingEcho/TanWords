//! Scenarios — communicative-situation packs and word membership.
//!
//! A *scenario* is a real-life communicative situation (ordering coffee,
//! airport check-in, a doctor's visit): a pack of dialogue lines grouped by
//! intent — each intent carrying the variant phrasings the other side might
//! use and the prepared answers the learner rehearses — plus a many-to-many
//! membership linking the user's bank words to the situations they appear
//! in, so the Words list can answer "show me my coffee-shop vocabulary".
//!
//! Deliberately NOT the dormant scene-lab experiment (`scenes`,
//! `scene_objects`, `scene_lessons`, … carry 3D-asset semantics): see
//! plan-scene-learning.md §3.1 for the naming decision. This module owns
//! `scenarios`, `word_scenarios`, and `scenario_lines`.
//!
//! Seed taxonomy: the ~50 prebuilt scenarios below ship checked-in (not
//! generated), inserted idempotently by `init_db`'s fingerprint pass with
//! `INSERT OR IGNORE` — a user's edits to a seed row's names survive every
//! re-run, and the seed never resurrects a scenario the user archived.

use crate::db::params;
use serde::{Deserialize, Serialize};
use crate::shim::State;

use crate::{db, AppState};

// ── Seed taxonomy ───────────────────────────────────────────────────────────

/// One seed row of the prebuilt scenario registry. `key` is the stable
/// external id used everywhere ids must survive a re-import.
pub(crate) struct ScenarioSeed {
    pub key: &'static str,
    pub name_en: &'static str,
    pub name_zh: &'static str,
    pub domain: &'static str,
    pub icon: &'static str,
    pub description: &'static str,
    pub sort_order: i64,
}

/// Every registry key in seeding order — the answer-key list the headless
/// binaries bake into their basic-info prompts (the GUI reads the TS mirror
/// in app/src/lib/scenarioSeeds.ts; both sides are guarded by tests).
pub fn scenario_seed_keys() -> Vec<&'static str> {
    SCENARIO_SEEDS.iter().map(|s| s.key).collect()
}

/// The prebuilt taxonomy: ~50 scenarios across 10 domains plus the
/// cross-scenario repair toolkit (`meta.repair`) whose lines render inside
/// every scenario's practice view — the highest-ROI sentences a learner
/// owns, per the pedagogical thesis in plan-scene-learning.md §1.1.
pub(crate) const SCENARIO_SEEDS: &[ScenarioSeed] = &[
    // dining
    ScenarioSeed { key: "dining.cafe", name_en: "Café / Coffee shop", name_zh: "咖啡店", domain: "dining", icon: "coffee", description: "Ordering drinks and food at a coffee counter.", sort_order: 100 },
    ScenarioSeed { key: "dining.restaurant", name_en: "Restaurant", name_zh: "餐厅", domain: "dining", icon: "utensils", description: "Being seated, ordering, and paying at a table-service restaurant.", sort_order: 110 },
    ScenarioSeed { key: "dining.fast-food", name_en: "Fast food", name_zh: "快餐店", domain: "dining", icon: "sandwich", description: "Counter ordering, combos, drive-through.", sort_order: 120 },
    ScenarioSeed { key: "dining.bar", name_en: "Bar / Pub", name_zh: "酒吧", domain: "dining", icon: "wine", description: "Ordering drinks, small talk with the bartender.", sort_order: 130 },
    ScenarioSeed { key: "dining.bakery", name_en: "Bakery", name_zh: "面包店", domain: "dining", icon: "croissant", description: "Buying bread and pastries.", sort_order: 140 },
    // travel
    ScenarioSeed { key: "travel.airport", name_en: "Airport", name_zh: "机场", domain: "travel", icon: "plane", description: "Check-in, security, boarding.", sort_order: 200 },
    ScenarioSeed { key: "travel.flight", name_en: "On the plane", name_zh: "飞机上", domain: "travel", icon: "plane-takeoff", description: "Requests and exchanges with cabin crew.", sort_order: 210 },
    ScenarioSeed { key: "travel.hotel", name_en: "Hotel", name_zh: "酒店", domain: "travel", icon: "bed", description: "Check-in, requests, checkout.", sort_order: 220 },
    ScenarioSeed { key: "travel.customs", name_en: "Customs & immigration", name_zh: "海关入境", domain: "travel", icon: "shield", description: "Answering the officer's questions at the border.", sort_order: 230 },
    ScenarioSeed { key: "travel.car-rental", name_en: "Car rental", name_zh: "租车", domain: "travel", icon: "car", description: "Renting a car at the counter.", sort_order: 240 },
    ScenarioSeed { key: "travel.asking-directions", name_en: "Asking directions", name_zh: "问路", domain: "travel", icon: "map", description: "Finding your way in an unfamiliar place.", sort_order: 250 },
    // transport
    ScenarioSeed { key: "transport.rideshare-taxi", name_en: "Rideshare / Taxi", name_zh: "网约车 / 出租车", domain: "transport", icon: "car-taxi-front", description: "Telling the driver where to go, small talk.", sort_order: 300 },
    ScenarioSeed { key: "transport.public-transit", name_en: "Public transit", name_zh: "公共交通", domain: "transport", icon: "bus", description: "Buses, subways, tickets and transfers.", sort_order: 310 },
    ScenarioSeed { key: "transport.gas-station", name_en: "Gas station", name_zh: "加油站", domain: "transport", icon: "fuel", description: "Filling up, paying, convenience store.", sort_order: 320 },
    ScenarioSeed { key: "transport.car-repair", name_en: "Car repair", name_zh: "修车", domain: "transport", icon: "wrench", description: "Describing problems at the garage.", sort_order: 330 },
    // shopping
    ScenarioSeed { key: "shopping.supermarket", name_en: "Supermarket", name_zh: "超市", domain: "shopping", icon: "shopping-cart", description: "Finding items, checkout, bags.", sort_order: 400 },
    ScenarioSeed { key: "shopping.clothing", name_en: "Clothing store", name_zh: "服装店", domain: "shopping", icon: "shirt", description: "Sizes, fitting room, buying.", sort_order: 410 },
    ScenarioSeed { key: "shopping.pharmacy", name_en: "Pharmacy", name_zh: "药店", domain: "shopping", icon: "pill", description: "Over-the-counter medicine, asking the pharmacist.", sort_order: 420 },
    ScenarioSeed { key: "shopping.returns-exchanges", name_en: "Returns & exchanges", name_zh: "退换货", domain: "shopping", icon: "rotate-ccw", description: "Returning or exchanging a purchase.", sort_order: 430 },
    ScenarioSeed { key: "shopping.farmers-market", name_en: "Farmers market", name_zh: "农贸市场", domain: "shopping", icon: "apple", description: "Buying produce, haggling politely.", sort_order: 440 },
    // services
    ScenarioSeed { key: "services.bank", name_en: "Bank", name_zh: "银行", domain: "services", icon: "landmark", description: "Accounts, cards, teller counter.", sort_order: 500 },
    ScenarioSeed { key: "services.post-office", name_en: "Post office", name_zh: "邮局", domain: "services", icon: "package", description: "Mailing packages, stamps, tracking.", sort_order: 510 },
    ScenarioSeed { key: "services.haircut", name_en: "Haircut", name_zh: "理发", domain: "services", icon: "scissors", description: "Telling the barber what you want.", sort_order: 520 },
    ScenarioSeed { key: "services.phone-repair", name_en: "Phone repair", name_zh: "手机维修", domain: "services", icon: "smartphone", description: "Describing a broken device, quotes, pickup.", sort_order: 530 },
    ScenarioSeed { key: "services.dry-cleaning", name_en: "Dry cleaning", name_zh: "干洗店", domain: "services", icon: "shirt", description: "Dropping off and picking up laundry.", sort_order: 540 },
    // health
    ScenarioSeed { key: "health.doctor", name_en: "Doctor visit", name_zh: "看医生", domain: "health", icon: "stethoscope", description: "Describing symptoms at the clinic.", sort_order: 600 },
    ScenarioSeed { key: "health.dentist", name_en: "Dentist", name_zh: "牙医", domain: "health", icon: "smile", description: "Checkups, describing tooth problems.", sort_order: 610 },
    ScenarioSeed { key: "health.pharmacy-consult", name_en: "Pharmacy consult", name_zh: "药房咨询", domain: "health", icon: "pill", description: "Asking about dosage and interactions.", sort_order: 620 },
    ScenarioSeed { key: "health.emergency-room", name_en: "Emergency room", name_zh: "急诊", domain: "health", icon: "siren", description: "Triage, describing urgent symptoms.", sort_order: 630 },
    ScenarioSeed { key: "health.vet", name_en: "Vet", name_zh: "兽医", domain: "health", icon: "dog", description: "A pet's symptoms and treatment.", sort_order: 640 },
    // housing
    ScenarioSeed { key: "housing.apartment-viewing", name_en: "Apartment viewing", name_zh: "看房", domain: "housing", icon: "door-open", description: "Touring a rental, asking about terms.", sort_order: 700 },
    ScenarioSeed { key: "housing.landlord-repairs", name_en: "Landlord repairs", name_zh: "报修", domain: "housing", icon: "hammer", description: "Reporting something broken to the landlord.", sort_order: 710 },
    ScenarioSeed { key: "housing.utilities-setup", name_en: "Utilities setup", name_zh: "开通水电网", domain: "housing", icon: "plug", description: "Internet, electricity, water for a new place.", sort_order: 720 },
    ScenarioSeed { key: "housing.moving", name_en: "Moving", name_zh: "搬家", domain: "housing", icon: "truck", description: "Movers, elevator booking, mail forwarding.", sort_order: 730 },
    // work
    ScenarioSeed { key: "work.job-interview", name_en: "Job interview", name_zh: "求职面试", domain: "work", icon: "briefcase", description: "The classic interview exchange.", sort_order: 800 },
    ScenarioSeed { key: "work.meetings", name_en: "Meetings", name_zh: "会议", domain: "work", icon: "presentation", description: "Contributing, asking, wrapping up.", sort_order: 810 },
    ScenarioSeed { key: "work.office-small-talk", name_en: "Office small talk", name_zh: "办公室闲聊", domain: "work", icon: "coffee", description: "Elevator, kitchen, Monday-morning talk.", sort_order: 820 },
    ScenarioSeed { key: "work.phone-calls", name_en: "Phone calls", name_zh: "工作电话", domain: "work", icon: "phone", description: "Answering, placing on hold, taking messages.", sort_order: 830 },
    ScenarioSeed { key: "work.presentations", name_en: "Presentations", name_zh: "演讲展示", domain: "work", icon: "monitor", description: "Presenting work and handling questions.", sort_order: 840 },
    // social
    ScenarioSeed { key: "social.introductions", name_en: "Introductions", name_zh: "初次见面", domain: "social", icon: "handshake", description: "Meeting people, what do you do.", sort_order: 900 },
    ScenarioSeed { key: "social.party", name_en: "Party", name_zh: "聚会", domain: "social", icon: "party-popper", description: " Mingling, offers, goodbyes.", sort_order: 910 },
    ScenarioSeed { key: "social.neighbors", name_en: "Neighbors", name_zh: "邻居", domain: "social", icon: "home", description: "Favors, packages, noise.", sort_order: 920 },
    ScenarioSeed { key: "social.invitations", name_en: "Invitations", name_zh: "邀请与赴约", domain: "social", icon: "calendar", description: "Inviting, accepting, declining politely.", sort_order: 930 },
    ScenarioSeed { key: "social.giving-opinions", name_en: "Giving opinions", name_zh: "表达观点", domain: "social", icon: "message-circle", description: "Agreeing, disagreeing, hedging.", sort_order: 940 },
    // emergency
    ScenarioSeed { key: "emergency.police", name_en: "Police", name_zh: "报警", domain: "emergency", icon: "shield", description: "Reporting an incident to the police.", sort_order: 1000 },
    ScenarioSeed { key: "emergency.lost-items", name_en: "Lost items", name_zh: "遗失物品", domain: "emergency", icon: "search", description: "Lost & found, retracing steps.", sort_order: 1010 },
    ScenarioSeed { key: "emergency.accidents-insurance", name_en: "Accidents & insurance", name_zh: "事故与保险", domain: "emergency", icon: "file-text", description: "Exchanging info after a fender-bender.", sort_order: 1020 },
    // meta
    ScenarioSeed { key: "meta.repair", name_en: "Repair toolkit", name_zh: "救场工具箱", domain: "meta", icon: "life-buoy", description: "Cross-scenario lines: asking to repeat, buying time, changing your order. Shown inside every scenario.", sort_order: 1100 },
];

/// Idempotently inserts the seed taxonomy. Runs on `init_db`'s fingerprint
/// pass for both backends. `INSERT OR IGNORE` keeps a re-run a no-op on
/// every existing row — including rows the user renamed or archived — so
/// seeding is append-only (plan §4.2).
pub(crate) async fn seed_scenarios(conn: &db::Conn) -> Result<(), db::DbErr> {
    for s in SCENARIO_SEEDS {
        let sql = match conn.kind() {
            db::DbKind::Postgres => {
                "INSERT INTO scenarios (scenario_key, name_en, name_zh, domain, icon, description, origin, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'prebuilt', ?7) ON CONFLICT DO NOTHING"
            }
            db::DbKind::Local => {
                "INSERT OR IGNORE INTO scenarios (scenario_key, name_en, name_zh, domain, icon, description, origin, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'prebuilt', ?7)"
            }
        };
        conn.execute(
            sql,
            params![s.key, s.name_en, s.name_zh, s.domain, s.icon, s.description, s.sort_order],
        )
        .await?;
    }
    Ok(())
}

// ── Types ────────────────────────────────────────────────────────────────────

/// One gallery card: the registry row plus the per-scene stats the gallery
/// and the Words filter popover read. `untagged_words` rides only on the
/// payload wrapper (it's a global, not per-scene, number).
#[derive(Serialize)]
pub struct ScenarioSummary {
    pub id: i64,
    pub scenario_key: String,
    pub name_en: String,
    pub name_zh: String,
    pub domain: String,
    pub icon: String,
    pub description: String,
    pub origin: String,
    pub archived: bool,
    pub sort_order: i64,
    /// How many of the user's bank words link to this scenario.
    pub word_count: i64,
    /// How many of those are not yet mastered.
    pub unmastered_count: i64,
    /// Pack lines this scenario holds.
    pub line_count: i64,
}

/// `db_list_scenarios` payload: the registry + per-scene stats, plus the
/// global coverage number the gallery header shows.
#[derive(Serialize)]
pub struct ScenarioList {
    pub scenarios: Vec<ScenarioSummary>,
    /// Words with zero `word_scenarios` rows — every coverage pass's goal
    /// is to shrink this monotonically (plan §6.7).
    pub untagged_words: i64,
}

/// A scenario's lines grouped by intent, in stored order.
#[derive(Serialize, Deserialize, Clone)]
pub struct ScenarioLineItem {
    pub id: i64,
    pub intent_key: String,
    pub role: String,
    pub text_en: String,
    pub text_zh: String,
    pub note: String,
    pub importance: i64,
    /// Set when the line has been promoted into the sentence bank.
    pub sentence_id: Option<i64>,
    pub sort_order: i64,
}

/// `db_get_scenario_detail` payload: the scenario row + its lines + the
/// member words' list rows (id, word, status — enough for the Words tab).
#[derive(Serialize)]
pub struct ScenarioDetail {
    pub id: i64,
    pub scenario_key: String,
    pub name_en: String,
    pub name_zh: String,
    pub domain: String,
    pub icon: String,
    pub description: String,
    pub origin: String,
    pub lines: Vec<ScenarioLineItem>,
    /// Member bank words: (word_id, word, status, starred).
    pub words: Vec<ScenarioWordItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScenarioWordItem {
    pub word_id: i64,
    pub word: String,
    pub status: String,
    pub starred: bool,
    /// Which link source put this word here (provenance display).
    pub source: String,
    pub confidence: f64,
    /// The registry key ("dining.cafe") — the stable external id used by
    /// every frontend toggle; survives re-imports where integers don't.
    pub scenario_key: String,
    /// Internal row id — needed by db_reject_word_scenario; never shown.
    pub scenario_id: i64,
}

/// One pack line as received from the AI generator / authoring UI.
#[derive(Serialize, Deserialize, Clone)]
pub struct ScenarioLineInput {
    pub intent_key: String,
    pub role: String,
    pub text_en: String,
    pub text_zh: String,
    pub note: String,
    pub importance: i64,
    pub sort_order: i64,
}

/// `db_save_scenario_pack` payload. Upserts the scenario row by key, then
/// replaces its lines and exact-matches suggested words into the bank.
#[derive(Deserialize)]
pub struct SaveScenarioPackInput {
    pub scenario_key: String,
    pub name_en: String,
    pub name_zh: String,
    pub domain: String,
    pub icon: String,
    pub description: String,
    /// Hash of scenario_key + prompt version + target levels — a duplicate
    /// save short-circuits (idempotency cribbed from db_save_scene_lesson).
    pub generation_key: Option<String>,
    /// Replace the scenario's lines instead of merging (pack semantics).
    pub replace_lines: bool,
    pub lines: Vec<ScenarioLineInput>,
    /// Suggested words: exact lowercase text matches against the bank get
    /// `word_scenarios(source='scenario-pack')` links in the same
    /// transaction.
    pub suggested_words: Vec<String>,
}

/// Result of saving a pack: what the caller's toast should say.
#[derive(Serialize)]
pub struct SaveScenarioPackResult {
    pub scenario_id: i64,
    pub lines_saved: i64,
    /// Suggested words matched into the existing bank.
    pub words_linked: i64,
    /// Suggested words that weren't in the bank and were added
    /// (`words.source='scenario'`).
    pub words_added: i64,
    /// True when the generation_key short-circuited a duplicate save.
    pub duplicate: bool,
}

/// Result of a low-confidence-link review action.
#[derive(Serialize)]
pub struct ReviewQueueItem {
    pub word_id: i64,
    pub word: String,
    pub scenario_key: String,
    pub scenario_name_en: String,
    pub source: String,
    pub confidence: f64,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Registry + per-scene stats in one query, ordered for the gallery
/// (unarchived first, domain, then sort_order). Drives the Scenes page and
/// the Words list's scene filter popover (via `db_list_word_scenario_counts`,
/// which shares the LEFT JOIN shape).
#[crate::shim::command]
pub async fn db_list_scenarios(conn: State<'_, AppState>) -> Result<ScenarioList, String> {
    let db = db::conn(&conn)?;
    let rows: Vec<(i64, String, String, String, String, String, String, String, i64, i64, i64, i64)> = db::fetch_all(
        &db,
        "SELECT s.id, s.scenario_key, s.name_en, s.name_zh, s.domain, s.icon, s.description, s.origin,
                s.archived, s.sort_order,
                (SELECT COUNT(*) FROM word_scenarios ws WHERE ws.scenario_id = s.id AND ws.rejected = 0),
                (SELECT COUNT(*) FROM word_scenarios ws JOIN words w ON w.id = ws.word_id
                  WHERE ws.scenario_id = s.id AND ws.rejected = 0 AND COALESCE(w.status,'learning') != 'mastered')
         FROM scenarios s
         WHERE s.archived = 0
         ORDER BY s.sort_order, s.scenario_key",
        (),
        |r| {
            Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?,
            ))
        },
    )
    .await?;
    let mut scenarios = Vec::with_capacity(rows.len());
    for (id, key, name_en, name_zh, domain, icon, description, origin, archived, sort_order, word_count, unmastered) in rows {
        // line_count per scenario in one grouped pass (avoids a correlated
        // subquery per row; the gallery is ~50 rows either way).
        let line_count = db::scalar_i64(
            &db,
            "SELECT COUNT(*) FROM scenario_lines WHERE scenario_id = ?1",
            params![id],
        )
        .await?;
        scenarios.push(ScenarioSummary {
            id, scenario_key: key, name_en, name_zh, domain, icon, description, origin,
            archived: archived != 0, sort_order, word_count, unmastered_count: unmastered, line_count,
        });
    }
    let untagged_words = db::scalar_i64(
        &db,
        "SELECT COUNT(*) FROM words w WHERE NOT EXISTS (SELECT 1 FROM word_scenarios ws WHERE ws.word_id = w.id AND ws.rejected = 0)",
        (),
    )
    .await?;
    Ok(ScenarioList { scenarios, untagged_words })
}

/// Lines grouped by intent (ordered) plus the scenario row and member
/// words. The detail view's single fetch. Keyed by `scenario_key` — the
/// stable external id that survives re-imports (the page never sees or
/// passes integer ids).
#[crate::shim::command]
pub async fn db_get_scenario_detail(
    scenario_key: String,
    conn: State<'_, AppState>,
) -> Result<Option<ScenarioDetail>, String> {
    let db = db::conn(&conn)?;
    let header: Option<(i64, String, String, String, String, String, String, String)> = db::fetch_optional(
        &db,
        "SELECT id, scenario_key, name_en, name_zh, domain, icon, description, origin
         FROM scenarios WHERE scenario_key = ?1",
        params![scenario_key],
        |r| {
            Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
            ))
        },
    )
    .await?;
    let Some((id, key, name_en, name_zh, domain, icon, description, origin)) = header else {
        return Ok(None);
    };
    let lines: Vec<ScenarioLineItem> = db::fetch_all(
        &db,
        "SELECT id, intent_key, role, text_en, text_zh, note, importance, sentence_id, sort_order
         FROM scenario_lines WHERE scenario_id = ?1 ORDER BY sort_order, id",
        params![id],
        |r| {
            Ok(ScenarioLineItem {
                id: r.get(0)?,
                intent_key: r.get(1)?,
                role: r.get(2)?,
                text_en: r.get(3)?,
                text_zh: r.get(4)?,
                note: r.get(5)?,
                importance: r.get(6)?,
                sentence_id: r.get(7)?,
                sort_order: r.get(8)?,
            })
        },
    )
    .await?;
    let words: Vec<ScenarioWordItem> = db::fetch_all(
        &db,
        "SELECT ws.word_id, w.word, COALESCE(w.status,'learning'), w.starred != 0, ws.source, ws.confidence,
                sc.scenario_key, ws.scenario_id
         FROM word_scenarios ws
         JOIN words w ON w.id = ws.word_id
         JOIN scenarios sc ON sc.id = ws.scenario_id
         WHERE ws.scenario_id = ?1 AND ws.rejected = 0
         ORDER BY LOWER(w.word)",
        params![id],
        |r| {
            Ok(ScenarioWordItem {
                word_id: r.get(0)?,
                word: r.get(1)?,
                status: r.get(2)?,
                starred: r.get(3)?,
                source: r.get(4)?,
                confidence: r.get(5)?,
                scenario_key: r.get(6)?,
                scenario_id: r.get(7)?,
            })
        },
    )
    .await?;
    Ok(Some(ScenarioDetail {
        id, scenario_key: key, name_en, name_zh, domain, icon, description, origin, lines, words,
    }))
}

/// Insert-or-ignore one word↔scenario link. Never overwrites an existing
/// row (any source): the PK absorbs the duplicate, which is what makes
/// every coverage pass re-runnable. `ON CONFLICT DO UPDATE` on confidence
/// is deliberately NOT used — an older higher-confidence answer must not
/// be silently replaced by a newer lower one.
pub async fn link_word_scenario(
    tx: &db::Conn,
    word_id: i64,
    scenario_id: i64,
    source: &str,
    confidence: f64,
) -> Result<(), String> {
    let sql = match tx.kind() {
        db::DbKind::Postgres => {
            "INSERT INTO word_scenarios (word_id, scenario_id, source, confidence)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING"
        }
        db::DbKind::Local => {
            "INSERT OR IGNORE INTO word_scenarios (word_id, scenario_id, source, confidence)
             VALUES (?1, ?2, ?3, ?4)"
        }
    };
    tx.execute(sql, params![word_id, scenario_id, source, confidence])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Upsert a scenario pack: the registry row by key, its lines, and links
/// for suggested words that exact-match the bank. The generation_key
/// short-circuits a duplicate AI save before anything is written
/// (idempotency pattern cribbed from `db_save_scene_lesson`).
#[crate::shim::command]
pub async fn db_save_scenario_pack(
    input: SaveScenarioPackInput,
    conn: State<'_, AppState>,
) -> Result<SaveScenarioPackResult, String> {
    let key = input.scenario_key.trim().to_lowercase();
    if key.is_empty() {
        return Err("scenario_key is required".into());
    }
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;

    // Idempotency: a repeat save with the same generation_key is a no-op.
    // (generation_key is per-pack content, not stored as a column — the
    // check is "does this scenario already have lines from this key".)
    if let Some(gk) = input.generation_key.as_deref().filter(|s| !s.trim().is_empty()) {
        let stamp_var = "scenario_generation_keys";
        let existing: Option<String> = db::fetch_optional(
            &tx,
            "SELECT value FROM user_settings WHERE key = ?1",
            params![format!("{stamp_var}.{key}")],
            |r| r.get(0),
        )
        .await?;
        if existing.as_deref() == Some(gk) {
            let scenario_id: i64 = db::fetch_one(
                &tx,
                "SELECT id FROM scenarios WHERE scenario_key = ?1",
                params![key],
                |r| r.get(0),
            )
            .await?;
            return Ok(SaveScenarioPackResult {
                scenario_id,
                lines_saved: 0,
                words_linked: 0,
                words_added: 0,
                duplicate: true,
            });
        }
    }

    // Upsert the registry row (user-created scenarios arrive origin='user').
    let origin: Option<String> = db::fetch_optional(
        &tx,
        "SELECT origin FROM scenarios WHERE scenario_key = ?1",
        params![key.clone()],
        |r| r.get(0),
    )
    .await?;
    if origin.is_none() {
        tx.execute(
            "INSERT INTO scenarios (scenario_key, name_en, name_zh, domain, icon, description, origin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'user')",
            params![key.clone(), input.name_en, input.name_zh, input.domain, input.icon, input.description],
        )
        .await
        .map_err(|e| e.to_string())?;
    } else if input.replace_lines {
        // Pack content refresh: names may update, origin stays as-is (a
        // prebuilt seed stays prebuilt; an ai-proposed scenario accepted by
        // the user flips to 'user' at accept time, not here).
        tx.execute(
            "UPDATE scenarios SET name_en = ?2, name_zh = ?3, domain = ?4, icon = ?5, description = ?6, updated_at = CURRENT_TIMESTAMP
             WHERE scenario_key = ?1",
            params![key.clone(), input.name_en, input.name_zh, input.domain, input.icon, input.description],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    let scenario_id: i64 = db::fetch_one(
        &tx,
        "SELECT id FROM scenarios WHERE scenario_key = ?1",
        params![key.clone()],
        |r| r.get(0),
    )
    .await?;

    // Pack semantics: a save replaces the scenario's lines wholesale (the
    // generator produced the whole pack). Existing lines' sentence_id
    // back-references would dangle — but promotion copies the text into
    // the sentence bank, so deleting the line never deletes the promoted
    // sentence; the link is simply re-earned if the text is promoted again.
    if input.replace_lines {
        tx.execute("DELETE FROM scenario_lines WHERE scenario_id = ?1", params![scenario_id])
            .await
            .map_err(|e| e.to_string())?;
    }
    let mut lines_saved = 0i64;
    for line in &input.lines {
        let text_en = line.text_en.trim();
        if text_en.is_empty() {
            continue;
        }
        let role = if line.role == "me" { "me" } else { "them" };
        tx.execute(
            "INSERT INTO scenario_lines (scenario_id, intent_key, role, text_en, text_zh, note, importance, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                scenario_id,
                line.intent_key.trim().to_lowercase(),
                role,
                text_en,
                line.text_zh.clone(),
                line.note.clone(),
                line.importance.clamp(1, 5),
                line.sort_order,
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        lines_saved += 1;
    }

    // Suggested words: exact lowercase match into the bank → links. Words
    // that don't exist yet are INSERTED with source='scenario' (the plan's
    // "add N words to bank" offer happens in the UI; this side makes the
    // pack save self-sufficient) and linked the same way.
    let mut words_linked = 0i64;
    let mut words_added = 0i64;
    for word in &input.suggested_words {
        let w = word.trim().to_lowercase();
        if w.is_empty() {
            continue;
        }
        let word_id: Option<i64> = db::fetch_optional(
            &tx,
            "SELECT id FROM words WHERE lower(word) = ?1",
            params![w.clone()],
            |r| r.get(0),
        )
        .await?;
        let id = if let Some(id) = word_id {
            id
        } else {
            let inserted: Option<i64> = db::fetch_optional(
                &tx,
                "INSERT INTO words (word, word_freq, source) VALUES (?1, 1, 'scenario')
                 ON CONFLICT(word) DO NOTHING RETURNING id",
                params![w.clone()],
                |r| r.get(0),
            )
            .await?;
            words_added += 1;
            match inserted {
                Some(id) => id,
                None => db::fetch_one(
                    &tx,
                    "SELECT id FROM words WHERE lower(word) = ?1",
                    params![w],
                    |r| r.get(0),
                )
                .await?,
            }
        };
        link_word_scenario(&tx, id, scenario_id, "scenario-pack", 0.9).await?;
        words_linked += 1;
    }

    // Stamp the generation key after a successful content write.
    if let Some(gk) = input.generation_key.as_deref().filter(|s| !s.trim().is_empty()) {
        tx.execute(
            "INSERT INTO user_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![format!("scenario_generation_keys.{key}"), gk],
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(SaveScenarioPackResult { scenario_id, lines_saved, words_linked, words_added, duplicate: false })
}

/// Replace a word's MANUAL scene set. Incoming rows land as
/// `source='manual', confidence=1.0`; existing non-manual rows are
/// untouched (manual edits never clobber AI evidence, and vice versa —
/// the filter reads the union). Removing a manual link is the veto: the
/// coverage engine re-runs never re-add what the user removed because a
/// re-run only ever INSERTs where NO row exists.
#[crate::shim::command]
pub async fn db_set_word_scenarios(
    word_id: i64,
    scenario_keys: Vec<String>,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;

    // Resolve the incoming keys to ids in one round trip (registry-sized).
    let keys: Vec<String> = scenario_keys
        .into_iter()
        .map(|k| k.trim().to_lowercase())
        .filter(|k| !k.is_empty())
        .collect();
    let mut ids: Vec<i64> = Vec::with_capacity(keys.len());
    if !keys.is_empty() {
        let placeholders = (1..=keys.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id FROM scenarios WHERE scenario_key IN ({placeholders}) AND archived = 0");
        let params: Vec<crate::db::Value> = keys.iter().map(|k| k.clone().into()).collect();
        ids = db::fetch_all(&tx, &sql, params, |r| r.get(0)).await?;
    }

    // Tombstone the manual rows not in the incoming set; keep every
    // non-manual row. Tombstoning (not DELETE) is what the §3.2 rule needs:
    // coverage passes are INSERT OR IGNORE on the PK, so a hard DELETE would
    // let the very next re-run resurrect what the user removed.
    if ids.is_empty() {
        tx.execute(
            "UPDATE word_scenarios SET rejected = 1 WHERE word_id = ?1 AND source = 'manual'",
            params![word_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    } else {
        let placeholders = (1..=ids.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
        tx.execute(
            &format!(
                "UPDATE word_scenarios SET rejected = 1 WHERE word_id = ?{} AND source = 'manual'
                 AND scenario_id NOT IN ({placeholders})",
                ids.len() + 1
            ),
            {
                let mut v: Vec<crate::db::Value> = ids.iter().map(|i| (*i).into()).collect();
                v.push(word_id.into());
                v
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    for scenario_id in ids {
        // Manual (re-)link: INSERT OR IGNORE, then un-tombstone + force
        // manual source — an explicit user choice overrides any prior
        // rejection of the same pair.
        link_word_scenario(&tx, word_id, scenario_id, "manual", 1.0).await?;
        tx.execute(
            "UPDATE word_scenarios SET rejected = 0, source = 'manual', confidence = 1.0
             WHERE word_id = ?1 AND scenario_id = ?2",
            params![word_id, scenario_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Promote a scenario line into the sentence bank (lazy + explicit, plan
/// §3.4): insert into `sentences(source='scenario')`, seed its SRS row,
/// write the id back to `scenario_lines.sentence_id`. Re-promoting the
/// same line is a no-op (the back-reference short-circuits; and even a
/// missing back-reference dedups by exact text like `db_save_sentence`).
#[crate::shim::command]
pub async fn db_promote_scenario_line(
    line_id: i64,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    let line: Option<(Option<i64>, String, String)> = db::fetch_optional(
        &tx,
        "SELECT sentence_id, text_en, text_zh FROM scenario_lines WHERE id = ?1",
        params![line_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .await?;
    let Some((existing_sentence_id, text_en, text_zh)) = line else {
        return Err("scenario line not found".into());
    };
    if let Some(sid) = existing_sentence_id {
        return Ok(sid);
    }
    // Dedup by exact sentence text, like db_save_sentence.
    let existing: Option<i64> = db::fetch_optional(
        &tx,
        "SELECT id FROM sentences WHERE sentence = ?1 LIMIT 1",
        params![text_en.clone()],
        |r| r.get(0),
    )
    .await?;
    let sentence_id = match existing {
        Some(id) => id,
        None => {
            db::fetch_one(
                &tx,
                "INSERT INTO sentences (sentence, zh, source, updated_at) VALUES (?1, ?2, 'scenario', CURRENT_TIMESTAMP) RETURNING id",
                params![text_en, text_zh],
                |r| r.get(0),
            )
            .await?
        }
    };
    tx.execute(
        "INSERT OR IGNORE INTO srs_records (entity_id, entity_type, srs_level, srs_ease) VALUES (?1, 'sentence', 0, 2.5)",
        params![sentence_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE scenario_lines SET sentence_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![sentence_id, line_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(sentence_id)
}

/// Propose a new scenario (taxonomy growth from data, plan §3.5):
/// `origin='ai-proposed'` rows surface in the gallery for one-click
/// accept. Accepting (the UI) flips `origin` to `'user'` via this same
/// command with `accept=true`.
#[crate::shim::command]
pub async fn db_propose_scenario(
    scenario_key: String,
    name_en: String,
    name_zh: String,
    domain: String,
    accept: Option<bool>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    let key = scenario_key.trim().to_lowercase();
    if key.is_empty() {
        return Err("scenario_key is required".into());
    }
    let accept = accept.unwrap_or(false);
    let origin = if accept { "user" } else { "ai-proposed" };
    let id = db::fetch_one(
        &db,
        "INSERT INTO scenarios (scenario_key, name_en, name_zh, domain, origin)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(scenario_key) DO UPDATE SET name_en = excluded.name_en, name_zh = excluded.name_zh,
           domain = excluded.domain, origin = ?5, archived = 0, updated_at = CURRENT_TIMESTAMP
         RETURNING id",
        params![key, name_en, name_zh, domain, origin],
        |r| r.get(0),
    )
    .await?;
    Ok(id)
}

/// The review queue (plan §6.6): low-confidence links the user can accept
/// (no-op — the link already exists) or reject (delete the row; the
/// tombstone rule keeps re-runs from resurrecting it).
#[crate::shim::command]
pub async fn db_list_scenario_review_queue(
    limit: i64,
    conn: State<'_, AppState>,
) -> Result<Vec<ReviewQueueItem>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT ws.word_id, w.word, sc.scenario_key, sc.name_en, ws.source, ws.confidence
         FROM word_scenarios ws
         JOIN words w ON w.id = ws.word_id
         JOIN scenarios sc ON sc.id = ws.scenario_id
         WHERE ws.confidence < 0.7 AND ws.source != 'manual' AND ws.rejected = 0
         ORDER BY ws.confidence ASC
         LIMIT ?1",
        params![limit.clamp(1, 500)],
        |r| {
            Ok(ReviewQueueItem {
                word_id: r.get(0)?,
                word: r.get(1)?,
                scenario_key: r.get(2)?,
                scenario_name_en: r.get(3)?,
                source: r.get(4)?,
                confidence: r.get(5)?,
            })
        },
    )
    .await
}

/// Reject one review-queue item: tombstone the link (rejected=1) instead of
/// deleting the row. The row's PK keeps existing, so the INSERT OR IGNORE a
/// coverage re-run performs lands as a no-op — the rejection survives every
/// future pass (the §3.2 tombstone rule). A manual re-link is the only
/// explicit path back (db_set_word_scenarios clears the flag).
#[crate::shim::command]
pub async fn db_reject_word_scenario(
    word_id: i64,
    scenario_id: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE word_scenarios SET rejected = 1 WHERE word_id = ?1 AND scenario_id = ?2",
        params![word_id, scenario_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// A word's current scenario links (for the detail panel's chips row).
#[crate::shim::command]
pub async fn db_get_word_scenarios(
    word_id: i64,
    conn: State<'_, AppState>,
) -> Result<Vec<ScenarioWordItem>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT ws.word_id, w.word, COALESCE(w.status,'learning'), w.starred != 0, ws.source, ws.confidence,
                sc.scenario_key, ws.scenario_id
         FROM word_scenarios ws
         JOIN words w ON w.id = ws.word_id
         JOIN scenarios sc ON sc.id = ws.scenario_id
         WHERE ws.word_id = ?1 AND ws.rejected = 0
         ORDER BY LOWER(w.word)",
        params![word_id],
        |r| {
            Ok(ScenarioWordItem {
                word_id: r.get(0)?,
                word: r.get(1)?,
                status: r.get(2)?,
                starred: r.get(3)?,
                source: r.get(4)?,
                confidence: r.get(5)?,
                scenario_key: r.get(6)?,
                scenario_id: r.get(7)?,
            })
        },
    )
    .await
}

/// JIT reverse-direction suggestion (plan §6.5): given a scenario key and
/// the user's untagged word list, one AI-side *decision* is made client-side
/// by the caller — this command only persists the verdicts. Pairs with the
/// frontend flow: fetch untagged words → ask the model "which belong?" →
/// pass the winners here. Links land as `source='jit', 0.8`; INSERT OR
/// IGNORE keeps existing rows (and tombstones) untouched.
#[crate::shim::command]
pub async fn db_link_words_to_scenario(
    scenario_key: String,
    word_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    let scenario_id: i64 = db::fetch_optional(
        &db,
        "SELECT id FROM scenarios WHERE scenario_key = ?1",
        params![scenario_key.clone()],
        |r| r.get(0),
    )
    .await?
    .ok_or_else(|| format!("unknown scenario key: {scenario_key}"))?;
    let mut linked = 0i64;
    for word_id in word_ids {
        let before = db::scalar_i64(
            &db,
            "SELECT COUNT(*) FROM word_scenarios WHERE word_id = ?1 AND scenario_id = ?2",
            params![word_id, scenario_id],
        )
        .await?;
        link_word_scenario(&db, word_id, scenario_id, "jit", 0.8).await?;
        let after = db::scalar_i64(
            &db,
            "SELECT COUNT(*) FROM word_scenarios WHERE word_id = ?1 AND scenario_id = ?2",
            params![word_id, scenario_id],
        )
        .await?;
        if after > before {
            linked += 1;
        }
    }
    Ok(linked)
}

/// Per-scenario word counts for the Words filter popover and the gallery —
/// relational, indexed, portable (unlike tags, no JSON folding needed).
/// Mirrors `db_list_word_tags`'s role for the tags axis.
#[crate::shim::command]
pub async fn db_list_word_scenario_counts(
    conn: State<'_, AppState>,
) -> Result<Vec<ScenarioSummary>, String> {
    let db = db::conn(&conn)?;
    let rows: Vec<(i64, String, String, String, String, String, String, String, i64, i64, i64, i64)> = db::fetch_all(
        &db,
        "SELECT s.id, s.scenario_key, s.name_en, s.name_zh, s.domain, s.icon, s.description, s.origin,
                s.archived, s.sort_order,
                (SELECT COUNT(*) FROM word_scenarios ws WHERE ws.scenario_id = s.id AND ws.rejected = 0),
                (SELECT COUNT(*) FROM word_scenarios ws JOIN words w ON w.id = ws.word_id
                  WHERE ws.scenario_id = s.id AND ws.rejected = 0 AND COALESCE(w.status,'learning') != 'mastered')
         FROM scenarios s
         WHERE s.archived = 0
         ORDER BY s.sort_order, s.scenario_key",
        (),
        |r| {
            Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?,
            ))
        },
    )
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, key, name_en, name_zh, domain, icon, description, origin, archived, sort_order, word_count, unmastered) in rows {
        let line_count = db::scalar_i64(
            &db,
            "SELECT COUNT(*) FROM scenario_lines WHERE scenario_id = ?1",
            params![id],
        )
        .await?;
        out.push(ScenarioSummary {
            id, scenario_key: key, name_en, name_zh, domain, icon, description, origin,
            archived: archived != 0, sort_order, word_count, unmastered_count: unmastered, line_count,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The seed taxonomy is checked-in data that drives both the registry
    /// and the enrichment prompt's answer key — pin its shape (unique
    /// keys, non-empty names, the repair toolkit present).
    #[test]
    fn seed_taxonomy_is_well_formed() {
        let mut seen = std::collections::HashSet::new();
        for s in SCENARIO_SEEDS {
            assert!(!s.key.is_empty(), "empty key");
            assert!(s.key.contains('.'), "key {} lacks a domain prefix", s.key);
            assert!(!s.name_en.is_empty(), "key {} lacks name_en", s.key);
            assert!(!s.name_zh.is_empty(), "key {} lacks name_zh", s.key);
            assert!(!s.domain.is_empty(), "key {} lacks domain", s.key);
            assert!(seen.insert(s.key), "duplicate key {}", s.key);
        }
        assert!(seen.contains("meta.repair"), "the cross-scenario repair toolkit must be seeded");
        assert!(SCENARIO_SEEDS.len() >= 40, "expected a ~50-scenario taxonomy, got {}", SCENARIO_SEEDS.len());
    }
}
