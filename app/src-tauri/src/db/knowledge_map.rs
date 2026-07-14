use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{db, AppState};

#[derive(Serialize)]
pub struct KnowledgeMapSummary {
    id: i64,
    root_label: String,
    root_type: String,
    node_count: i64,
    updated_at: String,
}
#[derive(Serialize)]
pub struct KnowledgeNode {
    id: i64,
    map_id: i64,
    parent_id: Option<i64>,
    kind: String,
    label: String,
    zh: String,
    level: String,
    note: String,
    depth: i64,
    sort_order: i64,
    expanded: bool,
    word_id: Option<i64>,
}
#[derive(Serialize)]
pub struct KnowledgeEdge {
    source_id: i64,
    target_id: i64,
    relation: String,
}
#[derive(Serialize)]
pub struct KnowledgeMapDetail {
    id: i64,
    root_label: String,
    root_type: String,
    target_levels: String,
    nodes: Vec<KnowledgeNode>,
    edges: Vec<KnowledgeEdge>,
}
#[derive(Deserialize)]
pub struct NewKnowledgeNode {
    kind: String,
    label: String,
    zh: String,
    level: String,
    note: String,
}
#[derive(Serialize)]
pub struct MapWordAddResult {
    added: i64,
    linked: i64,
    skipped: i64,
}

#[tauri::command]
pub fn db_list_knowledge_maps(
    conn: State<'_, AppState>,
) -> Result<Vec<KnowledgeMapSummary>, String> {
    let db = db::lock_db(&conn)?;
    let mut s=db.prepare("SELECT m.id,m.root_label,m.root_type,COUNT(n.id),m.updated_at FROM knowledge_maps m LEFT JOIN knowledge_nodes n ON n.map_id=m.id GROUP BY m.id ORDER BY m.updated_at DESC").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(KnowledgeMapSummary {
                id: r.get(0)?,
                root_label: r.get(1)?,
                root_type: r.get(2)?,
                node_count: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_create_knowledge_map(
    root_label: String,
    root_type: String,
    target_levels: String,
    conn: State<'_, AppState>,
) -> Result<i64, String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO knowledge_maps(root_label,root_type,target_levels) VALUES(?1,?2,?3)",
        params![root_label.trim(), root_type, target_levels],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO knowledge_nodes(map_id,kind,label,depth,expanded) VALUES(?1,'topic',?2,0,0)",
        params![id, root_label.trim()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn db_get_knowledge_map(
    map_id: i64,
    conn: State<'_, AppState>,
) -> Result<Option<KnowledgeMapDetail>, String> {
    let db = db::lock_db(&conn)?;
    let h = db
        .query_row(
            "SELECT root_label,root_type,target_levels FROM knowledge_maps WHERE id=?1",
            [map_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((root_label, root_type, target_levels)) = h else {
        return Ok(None);
    };
    let mut ns=db.prepare("SELECT id,map_id,parent_id,kind,label,zh,level,note,depth,sort_order,expanded,word_id FROM knowledge_nodes WHERE map_id=?1 ORDER BY depth,sort_order,id").map_err(|e|e.to_string())?;
    let nodes = ns
        .query_map([map_id], |r| {
            Ok(KnowledgeNode {
                id: r.get(0)?,
                map_id: r.get(1)?,
                parent_id: r.get(2)?,
                kind: r.get(3)?,
                label: r.get(4)?,
                zh: r.get(5)?,
                level: r.get(6)?,
                note: r.get(7)?,
                depth: r.get(8)?,
                sort_order: r.get(9)?,
                expanded: r.get::<_, i64>(10)? != 0,
                word_id: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut es = db
        .prepare("SELECT source_id,target_id,relation FROM knowledge_edges WHERE map_id=?1")
        .map_err(|e| e.to_string())?;
    let edges = es
        .query_map([map_id], |r| {
            Ok(KnowledgeEdge {
                source_id: r.get(0)?,
                target_id: r.get(1)?,
                relation: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some(KnowledgeMapDetail {
        id: map_id,
        root_label,
        root_type,
        target_levels,
        nodes,
        edges,
    }))
}

#[tauri::command]
pub fn db_add_knowledge_nodes(
    map_id: i64,
    parent_id: i64,
    nodes: Vec<NewKnowledgeNode>,
    conn: State<'_, AppState>,
) -> Result<Vec<i64>, String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let depth: i64 = tx
        .query_row(
            "SELECT depth+1 FROM knowledge_nodes WHERE id=?1 AND map_id=?2",
            params![parent_id, map_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for (i, n) in nodes.iter().enumerate() {
        let label = n.label.trim();
        if label.is_empty() {
            continue;
        }
        tx.execute("INSERT OR IGNORE INTO knowledge_nodes(map_id,parent_id,kind,label,zh,level,note,depth,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![map_id,parent_id,n.kind,label,n.zh,n.level,n.note,depth,i as i64]).map_err(|e|e.to_string())?;
        let id: i64 = tx
            .query_row(
                "SELECT id FROM knowledge_nodes WHERE map_id=?1 AND parent_id=?2 AND label=?3",
                params![map_id, parent_id, label],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO knowledge_edges(map_id,source_id,target_id,relation) VALUES(?1,?2,?3,'contains')",params![map_id,parent_id,id]).map_err(|e|e.to_string())?;
        ids.push(id);
    }
    tx.execute(
        "UPDATE knowledge_nodes SET expanded=1 WHERE id=?1",
        [parent_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE knowledge_maps SET updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        [map_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ids)
}

#[tauri::command]
pub fn db_add_map_words_to_vocabulary(
    node_ids: Vec<i64>,
    conn: State<'_, AppState>,
) -> Result<MapWordAddResult, String> {
    let mut db = db::lock_db(&conn)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let mut added = 0;
    let mut linked = 0;
    let mut skipped = 0;
    for node_id in node_ids {
        let row = tx
            .query_row(
                "SELECT label,zh,level,word_id,kind FROM knowledge_nodes WHERE id=?1",
                [node_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<i64>>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((label, zh, level, current, kind)) = row else {
            skipped += 1;
            continue;
        };
        if current.is_some() || !(kind == "word" || kind == "phrase") {
            skipped += 1;
            continue;
        }
        let normalized = label.trim().to_lowercase();
        let existing = tx
            .query_row(
                "SELECT id FROM words WHERE lower(word)=?1",
                [&normalized],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let word_id = if let Some(id) = existing {
            linked += 1;
            id
        } else {
            tx.execute(
                "INSERT INTO words(word,level,word_freq,source) VALUES(?1,?2,1,'knowledge-map')",
                params![normalized, level],
            )
            .map_err(|e| e.to_string())?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO word_definitions(word_id,pos,zh,sort_order) VALUES(?1,'other',?2,0)",
                params![id, zh],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("INSERT OR IGNORE INTO srs_records(entity_id,entity_type,srs_level,srs_ease) VALUES(?1,'word',0,2.5)",[id]).map_err(|e|e.to_string())?;
            added += 1;
            id
        };
        tx.execute(
            "UPDATE knowledge_nodes SET word_id=?1 WHERE id=?2",
            params![word_id, node_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(MapWordAddResult {
        added,
        linked,
        skipped,
    })
}
