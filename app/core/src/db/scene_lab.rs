use crate::db::params;
use serde::{Deserialize, Serialize};
use crate::shim::State;

use crate::{db, AppState};

#[derive(Serialize)]
pub struct SceneSummary {
    scene_id: i64,
    scene_key: String,
    name: String,
    lesson_id: Option<i64>,
    learned: i64,
    total: i64,
    last_visited_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SceneExampleInput {
    kind: String,
    content_en: String,
    content_zh: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SceneVocabularyInput {
    pub id: Option<i64>,
    object_key: String,
    pub word_id: Option<i64>,
    pub word: String,
    pub zh: String,
    ipa: String,
    pub level: String,
    category: String,
    importance: i64,
    learning_status: String,
    examples: Vec<SceneExampleInput>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SceneRelationInput {
    source_key: String,
    relation: String,
    target_key: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SceneTaskInput {
    id: Option<i64>,
    title_en: String,
    title_zh: String,
    steps: serde_json::Value,
}

#[derive(Deserialize)]
pub struct SceneObjectInput {
    object_key: String,
    label: String,
    position: serde_json::Value,
    metadata: serde_json::Value,
}

#[derive(Deserialize)]
pub struct SaveSceneLessonInput {
    scene_key: String,
    scene_name: String,
    scene_type: String,
    asset_path: String,
    generation_version: i64,
    target_levels: String,
    prompt_version: i64,
    generation_key: String,
    objects: Vec<SceneObjectInput>,
    vocabulary: Vec<SceneVocabularyInput>,
    relations: Vec<SceneRelationInput>,
    tasks: Vec<SceneTaskInput>,
}

#[derive(Serialize)]
pub struct SceneLessonDetail {
    id: i64,
    scene_id: i64,
    target_levels: String,
    prompt_version: i64,
    generated_at: String,
    vocabulary: Vec<SceneVocabularyInput>,
    relations: Vec<SceneRelationInput>,
    tasks: Vec<SceneTaskInput>,
}

#[derive(Serialize)]
pub struct SceneProgress {
    total: i64,
    learned: i64,
    mastered: i64,
    attempts: i64,
}

#[derive(Serialize)]
pub struct SceneWordAddResult {
    added: i64,
    linked: i64,
    skipped: i64,
}

#[crate::shim::command]
pub async fn db_list_scenes(conn: State<'_, AppState>) -> Result<Vec<SceneSummary>, String> {
    let db = db::conn(&conn)?;
    db::fetch_all(
        &db,
        "SELECT s.id, s.scene_key, s.name,
                (SELECT id FROM scene_lessons l WHERE l.scene_id=s.id AND l.status='ready' ORDER BY generated_at DESC LIMIT 1),
                (SELECT COUNT(*) FROM scene_vocabulary v WHERE v.lesson_id=(SELECT id FROM scene_lessons l WHERE l.scene_id=s.id AND l.status='ready' ORDER BY generated_at DESC LIMIT 1) AND v.learning_status != 'new'),
                (SELECT COUNT(*) FROM scene_vocabulary v WHERE v.lesson_id=(SELECT id FROM scene_lessons l WHERE l.scene_id=s.id AND l.status='ready' ORDER BY generated_at DESC LIMIT 1)),
                (SELECT MAX(ss.started_at) FROM scene_sessions ss JOIN scene_lessons l ON l.id=ss.lesson_id WHERE l.scene_id=s.id)
         FROM scenes s ORDER BY s.created_at",
        (),
        |row| {
            Ok(SceneSummary {
                scene_id: row.get(0)?,
                scene_key: row.get(1)?,
                name: row.get(2)?,
                lesson_id: row.get(3)?,
                learned: row.get(4)?,
                total: row.get(5)?,
                last_visited_at: row.get(6)?,
            })
        },
    )
    .await
}

#[crate::shim::command]
pub async fn db_save_scene_lesson(
    input: SaveSceneLessonInput,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    if let Some(id) = db::fetch_optional(
        &tx,
        "SELECT id FROM scene_lessons WHERE generation_key=?1",
        [input.generation_key.clone()],
        |r| r.get::<i64>(0),
    )
    .await?
    {
        return Ok(id);
    }
    tx.execute(
        "INSERT INTO scenes(scene_key,name,scene_type,asset_path,generation_version) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(scene_key) DO UPDATE SET name=excluded.name, scene_type=excluded.scene_type, asset_path=excluded.asset_path, generation_version=excluded.generation_version, updated_at=CURRENT_TIMESTAMP",
        params![input.scene_key.clone(), input.scene_name.clone(), input.scene_type.clone(), input.asset_path.clone(), input.generation_version]
    )
    .await
    .map_err(|e| e.to_string())?;
    let scene_id: i64 = db::fetch_one(
        &tx,
        "SELECT id FROM scenes WHERE scene_key=?1",
        [input.scene_key.clone()],
        |r| r.get::<i64>(0),
    )
    .await?;
    for object in &input.objects {
        tx.execute(
            "INSERT INTO scene_objects(scene_id,object_key,label,position_json,metadata_json) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(scene_id,object_key) DO UPDATE SET label=excluded.label, position_json=excluded.position_json, metadata_json=excluded.metadata_json",
            params![scene_id, object.object_key.clone(), object.label.clone(), object.position.to_string(), object.metadata.to_string()]
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    let lesson_id = db::fetch_one(
        &tx,
        "INSERT INTO scene_lessons(scene_id,target_levels,status,prompt_version,generation_key) VALUES(?1,?2,'ready',?3,?4) RETURNING id",
        params![scene_id, input.target_levels.clone(), input.prompt_version, input.generation_key.clone()],
        |r| r.get::<i64>(0),
    )
    .await?;
    for word in &input.vocabulary {
        let object_id: i64 = db::fetch_one(
            &tx,
            "SELECT id FROM scene_objects WHERE scene_id=?1 AND object_key=?2",
            params![scene_id, word.object_key.clone()],
            |r| r.get::<i64>(0),
        )
        .await?;
        let vocab_id = db::fetch_one(
            &tx,
            "INSERT INTO scene_vocabulary(lesson_id,object_id,word_id,word,zh,ipa,level,category,importance,learning_status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING id",
            params![lesson_id, object_id, word.word_id, word.word.to_lowercase(), word.zh.clone(), word.ipa.clone(), word.level.clone(), word.category.clone(), word.importance.clamp(1,5), word.learning_status.clone()],
            |r| r.get::<i64>(0),
        )
        .await?;
        for example in &word.examples {
            tx.execute("INSERT INTO scene_examples(scene_vocabulary_id,kind,content_en,content_zh) VALUES(?1,?2,?3,?4)", params![vocab_id, example.kind.clone(), example.content_en.clone(), example.content_zh.clone()])
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    for rel in &input.relations {
        tx.execute("INSERT INTO scene_relations(lesson_id,source_key,relation,target_key) VALUES(?1,?2,?3,?4)", params![lesson_id, rel.source_key.clone(), rel.relation.clone(), rel.target_key.clone()])
            .await
            .map_err(|e| e.to_string())?;
    }
    for (index, task) in input.tasks.iter().enumerate() {
        tx.execute("INSERT INTO scene_tasks(lesson_id,title_en,title_zh,steps_json,sort_order) VALUES(?1,?2,?3,?4,?5)", params![lesson_id, task.title_en.clone(), task.title_zh.clone(), task.steps.to_string(), index as i64])
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(lesson_id)
}

#[crate::shim::command]
pub async fn db_get_scene_lesson(
    lesson_id: i64,
    conn: State<'_, AppState>,
) -> Result<Option<SceneLessonDetail>, String> {
    let db = db::conn(&conn)?;
    let header: Option<(i64, String, i64, String)> = db::fetch_optional(
        &db,
        "SELECT scene_id,target_levels,prompt_version,generated_at FROM scene_lessons WHERE id=?1",
        [lesson_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .await?;
    let Some((scene_id, target_levels, prompt_version, generated_at)) = header else {
        return Ok(None);
    };
    let word_rows: Vec<(i64, String, Option<i64>, String, String, String, String, String, i64, String)> =
        db::fetch_all(
            &db,
            "SELECT v.id,o.object_key,v.word_id,v.word,v.zh,v.ipa,v.level,v.category,v.importance,v.learning_status FROM scene_vocabulary v JOIN scene_objects o ON o.id=v.object_id WHERE v.lesson_id=?1 ORDER BY v.importance DESC,v.word",
            [lesson_id],
            |r| {
                Ok((
                    r.get::<i64>(0)?,
                    r.get::<String>(1)?,
                    r.get::<Option<i64>>(2)?,
                    r.get::<String>(3)?,
                    r.get::<String>(4)?,
                    r.get::<String>(5)?,
                    r.get::<String>(6)?,
                    r.get::<String>(7)?,
                    r.get::<i64>(8)?,
                    r.get::<String>(9)?,
                ))
            },
        )
        .await?;
    let mut vocabulary = Vec::new();
    for (id, object_key, word_id, word, zh, ipa, level, category, importance, learning_status) in word_rows {
        let examples = db::fetch_all(
            &db,
            "SELECT kind,content_en,content_zh FROM scene_examples WHERE scene_vocabulary_id=?1 ORDER BY id",
            [id],
            |r| {
                Ok(SceneExampleInput {
                    kind: r.get(0)?,
                    content_en: r.get(1)?,
                    content_zh: r.get(2)?,
                })
            },
        )
        .await?;
        vocabulary.push(SceneVocabularyInput {
            id: Some(id),
            object_key,
            word_id,
            word,
            zh,
            ipa,
            level,
            category,
            importance,
            learning_status,
            examples,
        });
    }
    let relations = db::fetch_all(
        &db,
        "SELECT source_key,relation,target_key FROM scene_relations WHERE lesson_id=?1",
        [lesson_id],
        |r| {
            Ok(SceneRelationInput {
                source_key: r.get(0)?,
                relation: r.get(1)?,
                target_key: r.get(2)?,
            })
        },
    )
    .await?;
    let tasks = db::fetch_all(
        &db,
        "SELECT id,title_en,title_zh,steps_json FROM scene_tasks WHERE lesson_id=?1 ORDER BY sort_order",
        [lesson_id],
        |r| {
            let raw: String = r.get(3)?;
            Ok(SceneTaskInput {
                id: Some(r.get(0)?),
                title_en: r.get(1)?,
                title_zh: r.get(2)?,
                steps: serde_json::from_str(&raw).unwrap_or(serde_json::json!([])),
            })
        },
    )
    .await?;
    Ok(Some(SceneLessonDetail {
        id: lesson_id,
        scene_id,
        target_levels,
        prompt_version,
        generated_at,
        vocabulary,
        relations,
        tasks,
    }))
}

#[crate::shim::command]
pub async fn db_start_scene_session(
    lesson_id: i64,
    mode: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let db = db::conn(&conn)?;
    db::fetch_one(
        &db,
        "INSERT INTO scene_sessions(lesson_id,mode) VALUES(?1,?2) RETURNING id",
        params![lesson_id, mode],
        |r| r.get::<i64>(0),
    )
    .await
}

#[crate::shim::command]
pub async fn db_finish_scene_session(session_id: i64, conn: State<'_, AppState>) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute(
        "UPDATE scene_sessions SET completed_at=CURRENT_TIMESTAMP WHERE id=?1",
        [session_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_save_scene_attempt(
    session_id: i64,
    scene_vocabulary_id: i64,
    mode: String,
    correct: bool,
    response_ms: i64,
    hints_used: i64,
    conn: State<'_, AppState>,
) -> Result<(), String> {
    let db = db::conn(&conn)?;
    db.execute("INSERT INTO scene_attempts(session_id,scene_vocabulary_id,mode,correct,response_ms,hints_used) VALUES(?1,?2,?3,?4,?5,?6)", params![session_id,scene_vocabulary_id,mode,correct as i64,response_ms.max(0),hints_used.max(0)])
        .await
        .map_err(|e|e.to_string())?;
    let (total, wins): (i64, i64) = db::fetch_one(
        &db,
        "SELECT COUNT(*),COALESCE(SUM(correct),0) FROM scene_attempts WHERE scene_vocabulary_id=?1",
        [scene_vocabulary_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .await?;
    let status = if total >= 6 && wins * 100 / total >= 85 {
        "mastered"
    } else if total >= 3 && wins * 100 / total >= 65 {
        "familiar"
    } else {
        "learning"
    };
    db.execute(
        "UPDATE scene_vocabulary SET learning_status=?1 WHERE id=?2",
        params![status, scene_vocabulary_id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[crate::shim::command]
pub async fn db_get_scene_progress(
    lesson_id: i64,
    conn: State<'_, AppState>,
) -> Result<SceneProgress, String> {
    let db = db::conn(&conn)?;
    db::fetch_one(
        &db,
        "SELECT COUNT(*),COALESCE(SUM(CASE WHEN learning_status!='new' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN learning_status='mastered' THEN 1 ELSE 0 END),0),(SELECT COUNT(*) FROM scene_attempts a JOIN scene_vocabulary x ON x.id=a.scene_vocabulary_id WHERE x.lesson_id=?1) FROM scene_vocabulary WHERE lesson_id=?1",
        [lesson_id],
        |r| Ok(SceneProgress { total: r.get(0)?, learned: r.get(1)?, mastered: r.get(2)?, attempts: r.get(3)? }),
    )
    .await
}

#[crate::shim::command]
pub async fn db_add_scene_words_to_vocabulary(
    scene_vocabulary_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<SceneWordAddResult, String> {
    let db = db::txn_conn(&conn).await?;
    let tx = db.transaction().await.map_err(|e| e.to_string())?;
    let mut added = 0;
    let mut linked = 0;
    let mut skipped = 0;
    for scene_id in scene_vocabulary_ids {
        let row: Option<(String, String, String, Option<i64>)> = db::fetch_optional(
            &tx,
            "SELECT word,zh,level,word_id FROM scene_vocabulary WHERE id=?1",
            [scene_id],
            |r| {
                Ok((
                    r.get::<String>(0)?,
                    r.get::<String>(1)?,
                    r.get::<String>(2)?,
                    r.get::<Option<i64>>(3)?,
                ))
            },
        )
        .await?;
        let Some((word, zh, level, current_id)) = row else {
            skipped += 1;
            continue;
        };
        if current_id.is_some() {
            skipped += 1;
            continue;
        }
        let normalized = word.trim().to_lowercase();
        let existing = db::fetch_optional(
            &tx,
            "SELECT id FROM words WHERE lower(word)=?1",
            [normalized.clone()],
            |r| r.get::<i64>(0),
        )
        .await?;
        let word_id = if let Some(id) = existing {
            linked += 1;
            id
        } else {
            let id = db::fetch_one(
                &tx,
                "INSERT INTO words(word,word_type,level,word_freq,source) VALUES(?1,NULL,?2,1,'scene-lab') RETURNING id",
                params![normalized, level],
                |r| r.get::<i64>(0),
            )
            .await?;
            tx.execute(
                "INSERT INTO word_definitions(word_id,pos,zh,sort_order) VALUES(?1,'other',?2,0)",
                params![id, zh],
            )
            .await
            .map_err(|e| e.to_string())?;
            tx.execute("INSERT OR IGNORE INTO srs_records(entity_id,entity_type,srs_level,srs_ease) VALUES(?1,'word',0,2.5)",[id])
                .await
                .map_err(|e|e.to_string())?;
            added += 1;
            id
        };
        tx.execute(
            "UPDATE scene_vocabulary SET word_id=?1 WHERE id=?2",
            params![word_id, scene_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(SceneWordAddResult {
        added,
        linked,
        skipped,
    })
}
