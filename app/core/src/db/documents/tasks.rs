use serde_json::Value;

/// Walk a document's block JSON counting checklist blocks and, among them, how
/// many are checked. The format is a flat array of blocks where nesting is via
/// `children` (see `listing` in `app/src/components/Documents/tiptap/blocks.ts`
/// — `LIST_BLOCKS.checkListItem`), so the walk recurses.
///
/// Returns `(total, done)`. `content` may be malformed (or a legacy non-JSON
/// shape); that parses as an error and we report a blank 0/0 rather than fail a
/// save over a cosmetic counter.
pub fn count_tasks(content: &str) -> (i64, i64) {
    let Ok(root) = serde_json::from_str::<Value>(content) else {
        return (0, 0);
    };
    let blocks = match root {
        Value::Array(blocks) => blocks,
        Value::Object(map) => match map.get("children").and_then(Value::as_array) {
            Some(blocks) => blocks.clone(),
            None => return (0, 0),
        },
        _ => return (0, 0),
    };
    let mut total = 0i64;
    let mut done = 0i64;
    walk(&blocks, &mut total, &mut done);
    (total, done)
}

fn walk(blocks: &[Value], total: &mut i64, done: &mut i64) {
    for block in blocks {
        let Some(obj) = block.as_object() else { continue };
        if obj.get("type").and_then(Value::as_str) == Some("checkListItem") {
            *total += 1;
            let checked = obj
                .get("props")
                .and_then(Value::as_object)
                .and_then(|props| props.get("checked"))
                .and_then(Value::as_bool)
                == Some(true);
            if checked {
                *done += 1;
            }
        }
        if let Some(children) = obj.get("children").and_then(Value::as_array) {
            walk(children, total, done);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::count_tasks;

    #[test]
    fn counts_flat_checklist_and_nested_children() {
        let content = r#"[
            {"type":"paragraph","content":[{"type":"text","text":"hi"}]},
            {"type":"checkListItem","props":{"checked":true},"content":"done"},
            {"type":"checkListItem","props":{"checked":false},"content":"todo","children":[
                {"type":"checkListItem","props":{"checked":true},"content":"nested"}
            ]}
        ]"#;
        assert_eq!(count_tasks(content), (3, 2));
    }

    #[test]
    fn non_checklist_types_are_not_counted() {
        let content = r#"[
            {"type":"bulletListItem","props":{"checked":true}},
            {"type":"heading","props":{"checked":true}}
        ]"#;
        assert_eq!(count_tasks(content), (0, 0));
    }

    #[test]
    fn malformed_content_counts_zero_rather_than_panicking() {
        assert_eq!(count_tasks("not json"), (0, 0));
        assert_eq!(count_tasks(""), (0, 0));
        assert_eq!(count_tasks("42"), (0, 0));
    }

    #[test]
    fn object_root_with_children_wrapper_is_supported() {
        let content = r#"{"type":"doc","children":[
            {"type":"checkListItem","props":{"checked":false}}
        ]}"#;
        assert_eq!(count_tasks(content), (1, 0));
    }
}
