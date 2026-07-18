use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{db, AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingVocabularyInput {
    pub original_expression: String,
    pub word: String,
    pub meaning: String,
    pub reason: String,
    pub example_sentence: String,
    pub selected: bool,
}

#[derive(Debug, Deserialize)]
pub struct WritingSentenceInput {
    pub original: String,
    pub corrected: String,
    pub natural: String,
    pub explanation: String,
    pub vocabulary: Vec<WritingVocabularyInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSubmissionInput {
    pub original_text: String,
    pub input_type: String,
    pub detected_genre: String,
    pub overall_feedback: String,
    pub refined_full_text: String,
    pub structure_feedback: String,
    pub coherence_feedback: String,
    pub tone_feedback: String,
    pub sentences: Vec<WritingSentenceInput>,
    pub model_essays: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct WritingVocabularyRow {
    pub id: i64,
    pub original_expression: String,
    pub suggested_word: String,
    pub meaning: String,
    pub reason: String,
    pub example_sentence: String,
    pub selected: bool,
    pub vocabulary_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct WritingSentenceRow {
    pub id: i64,
    pub position: i64,
    pub original: String,
    pub corrected: String,
    pub natural: String,
    pub explanation: String,
    pub vocabulary: Vec<WritingVocabularyRow>,
}

#[derive(Debug, Serialize)]
pub struct WritingSubmissionRow {
    pub id: i64,
    pub original_text: String,
    pub input_type: String,
    pub detected_genre: String,
    pub overall_feedback: String,
    pub refined_full_text: String,
    pub structure_feedback: String,
    pub coherence_feedback: String,
    pub tone_feedback: String,
    pub created_at: String,
    pub sentences: Vec<WritingSentenceRow>,
    pub model_essays: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct WritingSummaryRow {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub source_type: String,
    pub source_snapshot: String,
    pub created_at: String,
}

#[tauri::command]
pub fn db_save_writing_submission(
    input: WritingSubmissionInput,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    if input.original_text.trim().is_empty() || input.sentences.is_empty() {
        return Err("Writing submission is empty".into());
    }
    let mut conn = db::lock_db(&state)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO writing_submissions
         (original_text,input_type,detected_genre,overall_feedback,refined_full_text,structure_feedback,coherence_feedback,tone_feedback,sentence_count)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![input.original_text, input.input_type, input.detected_genre, input.overall_feedback,
            input.refined_full_text, input.structure_feedback, input.coherence_feedback,
            input.tone_feedback, input.sentences.len() as i64],
    ).map_err(|e| e.to_string())?;
    let submission_id = tx.last_insert_rowid();

    for (position, sentence) in input.sentences.into_iter().enumerate() {
        tx.execute(
            "INSERT INTO writing_sentences (submission_id,position,original,corrected,natural,explanation) VALUES (?1,?2,?3,?4,?5,?6)",
            params![submission_id, position as i64, sentence.original, sentence.corrected, sentence.natural, sentence.explanation],
        ).map_err(|e| e.to_string())?;
        let sentence_id = tx.last_insert_rowid();

        for vocab in sentence.vocabulary {
            let vocabulary_id = if vocab.selected {
                let existing: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM words WHERE lower(word)=lower(?1) LIMIT 1",
                        [&vocab.word],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if let Some(id) = existing {
                    tx.execute(
                        "INSERT INTO word_definitions (word_id,pos,zh,example_en,sort_order)
                         SELECT ?1,'other',?2,?3,COALESCE((SELECT MAX(sort_order)+1 FROM word_definitions WHERE word_id=?1),0)
                         WHERE NOT EXISTS (SELECT 1 FROM word_definitions WHERE word_id=?1 AND example_en=?3)",
                        params![id, vocab.meaning, vocab.example_sentence],
                    ).map_err(|e| e.to_string())?;
                    Some(id)
                } else {
                    tx.execute(
                        "INSERT INTO words (word,level,word_freq,source,enrichment_text) VALUES (?1,NULL,1,'writing',?2)",
                        params![vocab.word, format!("{}\n\n> {}", vocab.reason, vocab.example_sentence)],
                    ).map_err(|e| e.to_string())?;
                    let id = tx.last_insert_rowid();
                    tx.execute(
                        "INSERT INTO word_definitions (word_id,pos,zh,example_en,sort_order) VALUES (?1,'other',?2,?3,0)",
                        params![id, vocab.meaning, vocab.example_sentence],
                    ).map_err(|e| e.to_string())?;
                    tx.execute(
                        "INSERT OR IGNORE INTO srs_records (entity_id,entity_type,srs_level,srs_ease) VALUES (?1,'word',0,2.5)", [id]
                    ).map_err(|e| e.to_string())?;
                    Some(id)
                }
            } else {
                None
            };
            tx.execute(
                "INSERT INTO writing_vocabulary (sentence_id,original_expression,suggested_word,meaning,reason,example_sentence,selected,vocabulary_id)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![sentence_id, vocab.original_expression, vocab.word, vocab.meaning, vocab.reason,
                    vocab.example_sentence, vocab.selected as i64, vocabulary_id],
            ).map_err(|e| e.to_string())?;
        }
    }
    for (position, essay) in input.model_essays.into_iter().enumerate() {
        tx.execute(
            "INSERT INTO writing_model_essays (submission_id,position,content) VALUES (?1,?2,?3)",
            params![submission_id, position as i64, essay],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(submission_id)
}

#[tauri::command]
pub fn db_list_writing_submissions(
    search: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<WritingSubmissionRow>, String> {
    let conn = db::lock_db(&state)?;
    let pattern = format!("%{}%", search.unwrap_or_default());
    let mut stmt = conn.prepare(
        "SELECT DISTINCT s.id,s.original_text,s.input_type,s.detected_genre,s.overall_feedback,s.refined_full_text,
                s.structure_feedback,s.coherence_feedback,s.tone_feedback,s.created_at
         FROM writing_submissions s LEFT JOIN writing_sentences x ON x.submission_id=s.id
         WHERE ?1='%%' OR s.original_text LIKE ?1 OR s.refined_full_text LIKE ?1 OR x.corrected LIKE ?1 OR x.natural LIKE ?1 OR x.explanation LIKE ?1
         ORDER BY s.created_at DESC,s.id DESC"
    ).map_err(|e| e.to_string())?;
    let base = stmt
        .query_map([pattern], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<
            Vec<(
                i64,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
            )>,
            _,
        >>()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (
        id,
        original_text,
        input_type,
        detected_genre,
        overall_feedback,
        refined_full_text,
        structure_feedback,
        coherence_feedback,
        tone_feedback,
        created_at,
    ) in base
    {
        let mut ss = conn.prepare("SELECT id,position,original,corrected,natural,explanation FROM writing_sentences WHERE submission_id=?1 ORDER BY position").map_err(|e| e.to_string())?;
        let sentence_base = ss
            .query_map([id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<(i64, i64, String, String, String, String)>, _>>()
            .map_err(|e| e.to_string())?;
        let mut sentences = Vec::new();
        for (sid, position, original, corrected, natural, explanation) in sentence_base {
            let mut vs = conn.prepare("SELECT id,original_expression,suggested_word,meaning,reason,example_sentence,selected,vocabulary_id FROM writing_vocabulary WHERE sentence_id=?1 ORDER BY id").map_err(|e| e.to_string())?;
            let vocabulary = vs
                .query_map([sid], |r| {
                    Ok(WritingVocabularyRow {
                        id: r.get(0)?,
                        original_expression: r.get(1)?,
                        suggested_word: r.get(2)?,
                        meaning: r.get(3)?,
                        reason: r.get(4)?,
                        example_sentence: r.get(5)?,
                        selected: r.get::<_, i64>(6)? != 0,
                        vocabulary_id: r.get(7)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            sentences.push(WritingSentenceRow {
                id: sid,
                position,
                original,
                corrected,
                natural,
                explanation,
                vocabulary,
            });
        }
        let mut es = conn
            .prepare(
                "SELECT content FROM writing_model_essays WHERE submission_id=?1 ORDER BY position",
            )
            .map_err(|e| e.to_string())?;
        let model_essays = es
            .query_map([id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?;
        out.push(WritingSubmissionRow {
            id,
            original_text,
            input_type,
            detected_genre,
            overall_feedback,
            refined_full_text,
            structure_feedback,
            coherence_feedback,
            tone_feedback,
            created_at,
            sentences,
            model_essays,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn db_delete_writing_submissions(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = db::lock_db(&state)?;
    for id in ids {
        conn.execute("DELETE FROM writing_submissions WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn db_delete_writing_sentences(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut conn = db::lock_db(&state)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut affected = Vec::new();
    for id in &ids {
        if let Ok(submission_id) = tx.query_row(
            "SELECT submission_id FROM writing_sentences WHERE id=?1",
            [id],
            |r| r.get::<_, i64>(0),
        ) {
            if !affected.contains(&submission_id) {
                affected.push(submission_id);
            }
        }
    }
    for id in ids {
        tx.execute("DELETE FROM writing_sentences WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM writing_submissions WHERE NOT EXISTS (SELECT 1 FROM writing_sentences WHERE submission_id=writing_submissions.id)", []).map_err(|e| e.to_string())?;
    for submission_id in affected {
        // Document-level feedback may quote deleted sentences. Clear it and
        // rebuild original_text only from remaining sentence rows.
        tx.execute(
            "UPDATE writing_submissions SET
                original_text=COALESCE((SELECT group_concat(original,' ') FROM writing_sentences WHERE submission_id=?1 ORDER BY position),''),
                overall_feedback='',refined_full_text='',structure_feedback='',coherence_feedback='',tone_feedback='',
                sentence_count=(SELECT COUNT(*) FROM writing_sentences WHERE submission_id=?1)
             WHERE id=?1",
            [submission_id],
        ).map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM writing_model_essays WHERE submission_id=?1",
            [submission_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_writing_summary(
    title: String,
    content: String,
    source_type: String,
    source_snapshot: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let conn = db::lock_db(&state)?;
    conn.execute("INSERT INTO writing_summaries (title,content,source_type,source_snapshot) VALUES (?1,?2,?3,?4)", params![title,content,source_type,source_snapshot]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn db_list_writing_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<WritingSummaryRow>, String> {
    let conn = db::lock_db(&state)?;
    let mut stmt = conn.prepare("SELECT id,title,content,source_type,source_snapshot,created_at FROM writing_summaries ORDER BY created_at DESC,id DESC").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WritingSummaryRow {
                id: r.get(0)?,
                title: r.get(1)?,
                content: r.get(2)?,
                source_type: r.get(3)?,
                source_snapshot: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_delete_writing_summaries(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = db::lock_db(&state)?;
    for id in ids {
        conn.execute("DELETE FROM writing_summaries WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
