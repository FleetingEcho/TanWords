//! E2E safety drill against a LOCAL COPY of the live backup (never the live
//! DB): simulate a bulk re-analyze where some words get new text, one gets a
//! garbage (empty) stream the guard must refuse, and the run "crashes" partway
//! — then verify every word either kept its old enrichment or got a new one,
//! never empty.
//!
//! ```ignore
//! cargo test --test guard_drill -- --ignored --nocapture
//! ```

use tanwords_lib::db;
use tanwords_lib::db::connection::{open, DbProfile};
use tanwords_lib::db::words_types::WordEnrichmentInput;
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
async fn reanalyze_crash_drill_never_empties() {
    let src = "/home/zteng/tanwords-backup-20261023.db";
    let copy = "/tmp/tanwords-guard-drill.db";
    let _ = std::fs::remove_file(copy);
    std::fs::copy(src, copy).expect("copy backup");
    let db = open(&DbProfile::Local { path: copy.into() }, None).await.unwrap();
    let conn = db.conn();
    let state = app_state_for(db);
    let boxed = Box::new(state);
    let static_ref: &'static AppState = Box::leak(boxed);
    let state: State<'static, AppState> = State::from_ref(static_ref);

    let enriched_before: i64 = tanwords_lib::db::scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM words WHERE enrichment_text IS NOT NULL", (),
    ).await.unwrap();
    assert!(enriched_before > 9000, "backup should carry the enrichments: {enriched_before}");
    println!("drill start: {enriched_before} enriched words in the copy");

    // sample the first 40 enriched words as if a re-analyze had queued them
    let sample: Vec<(i64, String)> = tanwords_lib::db::fetch_all(
        &conn,
        "SELECT id, word FROM words WHERE enrichment_text IS NOT NULL ORDER BY id LIMIT 40",
        (),
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).await.unwrap();
    let old_texts: Vec<String> = tanwords_lib::db::fetch_all(
        &conn,
        "SELECT enrichment_text FROM words WHERE enrichment_text IS NOT NULL ORDER BY id LIMIT 40",
        (),
        |r| r.get(0),
    ).await.unwrap();

    for (i, (id, word)) in sample.iter().enumerate() {
        if i >= 10 { break; } // "crash" after 10 words
        let input = if i % 4 == 3 {
            // every 4th word receives a garbage/truncated stream
            WordEnrichmentInput { text: "   \n > * # ".into(), zh_short: None, level: None }
        } else {
            WordEnrichmentInput {
                text: format!("drill replacement #{i} for {word} — long enough to pass the guard with plenty of real prose content"),
                zh_short: None, level: None,
            }
        };
        // the exact command the GUI's bulk enrich calls
        let _ = tanwords_lib::db::db_add_word_enriched(
            word.clone(), word.clone(), None, input, state.clone(),
        ).await;
        let _ = id;
    }
    println!("simulated crash after 10 words");

    // ── the assertions that matter ─────────────────────────────────────
    // 1. every one of the 40 sampled words still has non-empty enrichment
    let after: Vec<(i64, String)> = tanwords_lib::db::fetch_all(
        &conn,
        "SELECT id, enrichment_text FROM words WHERE enrichment_text IS NOT NULL ORDER BY id LIMIT 40",
        (),
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).await.unwrap();
    assert_eq!(after.len(), 40, "no sampled word lost its enrichment");
    for (id, text) in &after {
        assert!(!text.trim().is_empty(), "word {id} must never end up empty");
    }
    // 2. words 0,1,2,4,5,6,8,9 (non-garbage) got the new text
    for i in [0usize, 1, 2, 4, 5, 6, 8, 9] {
        assert!(after[i].1.contains("drill replacement"), "word {i} should have the new text");
    }
    // 3. words 3 and 7 (garbage refused) kept their ORIGINAL text
    for i in [3usize, 7] {
        assert_eq!(after[i].1, old_texts[i], "refused overwrite must keep the old text (word {i})");
    }
    // 4. untouched words 10..40 still have their original text
    for i in 10..40 {
        assert_eq!(after[i].1, old_texts[i], "untouched word {i} must be untouched");
    }
    // 5. the total enriched count never dropped
    let enriched_after: i64 = tanwords_lib::db::scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM words WHERE enrichment_text IS NOT NULL", (),
    ).await.unwrap();
    assert_eq!(enriched_after, enriched_before, "bulk re-analyze must not change the enriched count");

    println!("PASS: crash mid-run left every word with old or new content — never empty");
    let _ = std::fs::remove_file(copy);
    
}
