//! 10k-word scale probe for the Words list query path: measures db_get_words
//! (full dump, what the list used to call per keystroke) vs db_get_words_page
//! (the paged filter path) on a seeded 10k-word SQLite DB.
//!
//!   cargo test --test words_10k_bench -- --ignored --nocapture

use std::time::Instant;
use tanwords_lib::db;
use tanwords_lib::shim::State;
use tanwords_lib::AppState;

fn app_state_for(db: db::connection::Db) -> AppState {
    AppState {
        db: std::sync::Mutex::new(db),
        #[cfg(feature = "tts")]
        tts: std::sync::Mutex::new(None).into(),
        #[cfg(feature = "asr")]
        asr: std::sync::Mutex::new(None).into(),
        db_fallback_warning: None,
        document_privacy: Default::default(),
    }
}

#[tokio::test]
#[ignore]
async fn words_10k_bench() {
    let db = db::connection::open_memory().await.unwrap();
    let state = app_state_for(db);
    let boxed = Box::new(state);
    let static_ref: &'static AppState = Box::leak(boxed);
    let state = State::from_ref(static_ref);
    let conn = db::conn(&state).unwrap();

    // Seed 10k words + one definition each, mixed levels/sources/enrichment.
    let t0 = Instant::now();
    conn.execute_batch("BEGIN").await.unwrap();
    for i in 0..10_000 {
        let word = format!("word{i:05}");
        let level = ["C2", "C1", "B2", "B1", "A2"][i % 5];
        let source = ["manual", "ai", "chat"][i % 3];
        let enriched = if i % 2 == 0 { "NULL" } else { "'x'" };
        conn.execute(
            &format!(
                "INSERT INTO words (word, level, source, enrichment_text, status, starred, word_freq) VALUES ('{word}', '{level}', '{source}', {enriched}, 'learning', 0, {i})"
            ),
            (),
        )
        .await
        .unwrap();
        conn.execute(
            &format!(
                "INSERT INTO word_definitions (word_id, pos, zh, sort_order) VALUES ((SELECT id FROM words WHERE word='{word}'), 'n', '释义{i}', 0)"
            ),
            (),
        )
        .await
        .unwrap();
    }
    conn.execute_batch("COMMIT").await.unwrap();
    println!("seed 10k: {:?}", t0.elapsed());

    // Full dump — the OLD list path (per keystroke).
    let t1 = Instant::now();
    let all = db::db_get_words(None, None, None, None, None, None, state.clone()).await.unwrap();
    println!("full dump getWords (10k rows): {:?} -> {} rows", t1.elapsed(), all.len());

    // Paged empty search (open list).
    let t2 = Instant::now();
    let p0 = db::db_get_words_page(None, None, None, None, None, None, None, None, None, None, None, 20, 0, state.clone()).await.unwrap();
    println!("page open list (no search): {:?} -> {} items / total {}", t2.elapsed(), p0.items.len(), p0.total);

    // Paged prefix search — worst realistic keystroke case.
    for q in ["w", "word1", "word12", "word123", "zzz"] {
        let t = Instant::now();
        let p = db::db_get_words_page(Some(q.to_string()), None, None, None, None, None, None, Some("alpha".into()), None, None, None, 20, 0, state.clone()).await.unwrap();
        println!("page search '{q}': {:?} -> {} items / total {}", t.elapsed(), p.items.len(), p.total);
    }

    // Paged with every filter stacked.
    let t3 = Instant::now();
    let pf = db::db_get_words_page(
        Some("word".into()), Some(vec!["C2".into()]), Some(vec!["learning".into()]),
        Some(true), Some(true), Some("ai".into()), Some(true), Some("due".into()),
        Some("updated".into()), Some("2000-01-01".into()), Some("2099-01-01".into()),
        20, 0, state.clone(),
    ).await.unwrap();
    println!("page all-filters: {:?} -> {} items / total {}", t3.elapsed(), pf.items.len(), pf.total);

    // Light projections — the replacements for the old full-dump callers.
    let t4 = Instant::now();
    let ids = db::db_list_word_ids(false, state.clone()).await.unwrap();
    println!("list_word_ids (10k): {:?} -> {} ids", t4.elapsed(), ids.len());
    let t5 = Instant::now();
    let stats = db::db_get_word_stats(state.clone()).await.unwrap();
    println!("get_word_stats: {:?} -> total {} un_enriched {}", t5.elapsed(), stats.total, stats.un_enriched);
    let t6 = Instant::now();
    let exists = db::db_word_exists("word09999".into(), state.clone()).await.unwrap();
    println!("word_exists: {:?} -> {}", t6.elapsed(), exists);
    let t7 = Instant::now();
    let csv = db::db_export_words_csv(state.clone()).await.unwrap();
    println!("export_words_csv (10k): {:?} -> {} bytes", t7.elapsed(), csv.len());

    // Repeat runs to see steady-state (cache warm).
    for _ in 0..2 {
        let t = Instant::now();
        let _ = db::db_get_words_page(Some("word1".to_string()), None, None, None, None, None, None, Some("alpha".into()), None, None, None, 20, 0, state.clone()).await.unwrap();
        println!("page search 'word1' (warm): {:?}", t.elapsed());
    }
}
