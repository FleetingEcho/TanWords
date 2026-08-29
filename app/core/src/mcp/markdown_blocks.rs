//! Markdown → the app's document block format.
//!
//! `documents.content` is not Markdown: every editor-created document stores a
//! JSON array of blocks (see `app/src/components/Documents/tiptap/blocks.ts`).
//! The frontend converts Markdown with a full remark pipeline in the document
//! worker; the Rust side has no such pipeline, so this module implements the
//! subset an MCP agent realistically emits — headings, paragraphs, lists,
//! quotes, code fences, dividers, lone images, and inline
//! bold/italic/strike/code/link — producing exactly the shapes
//! `mdastToBlocks.ts` produces, so the transforms and adapters downstream of
//! the storage format keep pattern-matching. Anything outside the subset
//! degrades to plain text rather than corrupting the document.
//!
//! Appending raw Markdown onto the JSON body (the previous behaviour of
//! `documents_append`) made the column un-parseable, and the editor then
//! re-parsed the entire document — original body included — as literal
//! Markdown, rendering a dump of raw JSON and persisting it on save.

use serde_json::{Map, Value};

// ── inline ─────────────────────────────────────────────────────────────────

fn text_run(text: &str, styles: Map<String, Value>) -> Value {
    let mut run = Map::new();
    run.insert("type".to_string(), Value::String("text".to_string()));
    run.insert("text".to_string(), Value::String(text.to_string()));
    run.insert("styles".to_string(), Value::Object(styles));
    Value::Object(run)
}

fn with_style(styles: &Map<String, Value>, key: &str) -> Map<String, Value> {
    let mut inner = styles.clone();
    inner.insert(key.to_string(), Value::Bool(true));
    inner
}

fn flush_plain(plain: &mut String, out: &mut Vec<Value>, styles: &Map<String, Value>) {
    if !plain.is_empty() {
        out.push(text_run(plain, styles.clone()));
        plain.clear();
    }
}

/// Inline Markdown → inline content. `**bold**`, `*italic*`, `~~strike~~`,
/// `` `code` `` (exclusive of other styles, like BlockNote), and
/// `[label](href)`; nesting carries styles down. Unclosed markers are literal
/// text, never data loss.
fn parse_inline(text: &str, styles: &Map<String, Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    while let Some(offset) = rest.find(['*', '~', '`', '[']) {
        let (before, after) = rest.split_at(offset);
        plain.push_str(before);
        if after.starts_with("**") || after.starts_with("~~") {
            let marker = &after[..2];
            let key = if marker == "**" { "bold" } else { "strike" };
            if let Some(close) = after[2..].find(marker) {
                flush_plain(&mut plain, &mut out, styles);
                out.extend(parse_inline(
                    &after[2..2 + close],
                    &with_style(styles, key),
                ));
                rest = &after[2 + close + 2..];
                continue;
            }
            plain.push_str(marker);
            rest = &after[2..];
            continue;
        }
        if let Some(code) = after.strip_prefix('`') {
            if let Some(close) = code.find('`') {
                flush_plain(&mut plain, &mut out, styles);
                let mut code_styles = Map::new();
                code_styles.insert("code".to_string(), Value::Bool(true));
                out.push(text_run(&code[..close], code_styles));
                rest = &code[close + 1..];
                continue;
            }
            plain.push('`');
            rest = &after[1..];
            continue;
        }
        if let Some(label_start) = after.strip_prefix('[') {
            if let Some(bracket) = after.find("](") {
                if let Some(paren) = after[bracket + 2..].find(')') {
                    flush_plain(&mut plain, &mut out, styles);
                    let label = &after[1..bracket];
                    let href = &after[bracket + 2..bracket + 2 + paren];
                    let mut link = Map::new();
                    link.insert("type".to_string(), Value::String("link".to_string()));
                    link.insert("href".to_string(), Value::String(href.to_string()));
                    link.insert(
                        "content".to_string(),
                        Value::Array(parse_inline(label, styles)),
                    );
                    out.push(Value::Object(link));
                    rest = &after[bracket + 2 + paren + 1..];
                    continue;
                }
            }
            plain.push('[');
            rest = label_start;
            continue;
        }
        if let Some(single) = after.strip_prefix('*') {
            if let Some(close) = single.find('*') {
                if close > 0 {
                    flush_plain(&mut plain, &mut out, styles);
                    out.extend(parse_inline(
                        &single[..close],
                        &with_style(styles, "italic"),
                    ));
                    rest = &single[close + 1..];
                    continue;
                }
            }
            plain.push('*');
            rest = &after[1..];
            continue;
        }
        if let Some(single) = after.strip_prefix('~') {
            plain.push('~');
            rest = single;
            continue;
        }
        // Unreachable: the find set is exactly the prefixes handled above.
        plain.push_str(after);
        rest = "";
    }
    plain.push_str(rest);
    flush_plain(&mut plain, &mut out, styles);
    out
}

fn inline(content: &str) -> Value {
    Value::Array(parse_inline(content, &Map::new()))
}

// ── block construction ──────────────────────────────────────────────────────

/// The three style props every text-carrying block carries by default
/// (`withStyleDefaults` on the frontend side).
fn style_props() -> Map<String, Value> {
    let mut props = Map::new();
    props.insert(
        "backgroundColor".to_string(),
        Value::String("default".to_string()),
    );
    props.insert("textColor".to_string(), Value::String("default".to_string()));
    props.insert(
        "textAlignment".to_string(),
        Value::String("left".to_string()),
    );
    props
}

fn block(kind: &str, props: Map<String, Value>, content: Value) -> Value {
    let mut block = Map::new();
    block.insert("type".to_string(), Value::String(kind.to_string()));
    block.insert("props".to_string(), Value::Object(props));
    block.insert("content".to_string(), content);
    Value::Object(block)
}

// ── block-level parsing ─────────────────────────────────────────────────────

fn fence_of(trimmed: &str) -> Option<&str> {
    if trimmed.starts_with("```") {
        Some("```")
    } else if trimmed.starts_with("~~~") {
        Some("~~~")
    } else {
        None
    }
}

fn is_divider(trimmed: &str) -> bool {
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '-' || first == '*' || first == '_')
        && trimmed.chars().all(|c| c == first)
        && trimmed.chars().count() >= 3
}

/// List item marker: returns (type, task-checkbox, remaining text). Task
/// boxes are matched before plain bullets so `- [ ] x` is not read as the
/// literal text `[ ] x`.
fn list_marker(trimmed: &str) -> Option<(&'static str, Option<bool>, &str)> {
    for prefix in ["- [ ] ", "* [ ] ", "+ [ ] "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return Some(("checkListItem", Some(false), rest));
        }
    }
    for prefix in ["- [x] ", "- [X] ", "* [x] ", "* [X] ", "+ [x] ", "+ [X] "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return Some(("checkListItem", Some(true), rest));
        }
    }
    for prefix in ["- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return Some(("bulletListItem", None, rest));
        }
    }
    if trimmed == "-" || trimmed == "*" || trimmed == "+" {
        return Some(("bulletListItem", None, ""));
    }
    let digits = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
    if (1..=9).contains(&digits) {
        let after = &trimmed[digits..];
        if let Some(rest) = after.strip_prefix(". ").or_else(|| after.strip_prefix(") ")) {
            return Some(("numberedListItem", None, rest));
        }
        if after == "." || after == ")" {
            return Some(("numberedListItem", None, ""));
        }
    }
    None
}

fn starts_special(trimmed: &str) -> bool {
    fence_of(trimmed).is_some()
        || trimmed.starts_with('#')
        || trimmed.starts_with('>')
        || is_divider(trimmed)
        || list_marker(trimmed).is_some()
}

/// A paragraph that is nothing but `![alt](url)` becomes an image block, the
/// same promotion `mdastToBlocks` performs.
fn lone_image(trimmed: &str) -> Option<(String, String)> {
    let rest = trimmed.strip_prefix("![")?;
    let close = rest.find("](")?;
    let alt = &rest[..close];
    let tail = &rest[close + 2..];
    let url = tail.strip_suffix(')')?;
    Some((alt.to_string(), url.to_string()))
}

fn indent_of(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ').count()
}

/// Removes up to `target` leading spaces so nested content re-parses at its
/// own level. Extra indentation beyond the target is preserved for the
/// recursive call to see.
fn strip_indent_to(line: &str, target: usize) -> &str {
    let actual = indent_of(line).min(target);
    &line[actual..]
}

/// Markdown → blocks. The whole pipeline for MCP writes; see the module docs
/// for the covered subset.
pub(crate) fn markdown_to_blocks(markdown: &str) -> Vec<Value> {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut blocks: Vec<Value> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }

        if let Some(fence) = fence_of(trimmed) {
            let language = trimmed[3..].trim();
            let mut code_lines: Vec<&str> = Vec::new();
            i += 1;
            while i < lines.len() && !lines[i].trim_start().starts_with(fence) {
                code_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() {
                i += 1; // consume the closing fence; EOF is fine too
            }
            let mut props = Map::new();
            props.insert(
                "language".to_string(),
                Value::String(if language.is_empty() {
                    "text".to_string()
                } else {
                    language.to_string()
                }),
            );
            blocks.push(block(
                "codeBlock",
                props,
                Value::Array(vec![text_run(&code_lines.join("\n"), Map::new())]),
            ));
            continue;
        }

        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) {
            let after = &trimmed[hashes..];
            if after.is_empty() || after.starts_with(' ') {
                let mut props = style_props();
                props.insert("level".to_string(), Value::from(hashes as u64));
                props.insert("isToggleable".to_string(), Value::Bool(false));
                blocks.push(block("heading", props, inline(after.trim())));
                i += 1;
                continue;
            }
        }

        if is_divider(trimmed) {
            blocks.push(block("divider", Map::new(), Value::Null));
            i += 1;
            continue;
        }

        if let Some(quoted) = trimmed.strip_prefix('>') {
            let mut quote_lines = vec![quoted.trim().to_string()];
            i += 1;
            while i < lines.len() {
                let next = lines[i].trim_start();
                match next.strip_prefix('>') {
                    Some(rest) => {
                        quote_lines.push(rest.trim().to_string());
                        i += 1;
                    }
                    None => break,
                }
            }
            let mut props = Map::new();
            props.insert(
                "backgroundColor".to_string(),
                Value::String("default".to_string()),
            );
            props.insert("textColor".to_string(), Value::String("default".to_string()));
            blocks.push(block("quote", props, inline(&quote_lines.join("\n"))));
            continue;
        }

        if let Some((alt, url)) = lone_image(trimmed) {
            let mut props = Map::new();
            props.insert(
                "textAlignment".to_string(),
                Value::String("left".to_string()),
            );
            props.insert(
                "backgroundColor".to_string(),
                Value::String("default".to_string()),
            );
            props.insert("name".to_string(), Value::String(alt));
            props.insert("url".to_string(), Value::String(url));
            props.insert("caption".to_string(), Value::String(String::new()));
            props.insert("showPreview".to_string(), Value::Bool(true));
            blocks.push(block("image", props, Value::Null));
            i += 1;
            continue;
        }

        if list_marker(trimmed).is_some() {
            let indent = indent_of(line);
            while i < lines.len() {
                let item_line = lines[i];
                let item_trimmed = item_line.trim_start();
                if indent_of(item_line) != indent
                    || item_trimmed.is_empty()
                    || list_marker(item_trimmed).is_none()
                {
                    break;
                }
                let (kind, checked, content) = list_marker(item_trimmed).expect("checked above");
                let mut nested = String::new();
                i += 1;
                while i < lines.len() {
                    let nested_line = lines[i];
                    let nested_trimmed = nested_line.trim_start();
                    if nested_trimmed.is_empty() {
                        // A blank line belongs to the list only when content
                        // at list depth follows it.
                        let mut j = i;
                        while j < lines.len() && lines[j].trim().is_empty() {
                            j += 1;
                        }
                        if j < lines.len() && indent_of(lines[j]) > indent {
                            for _ in i..j {
                                nested.push('\n');
                            }
                            i = j;
                            continue;
                        }
                        i = j;
                        break;
                    }
                    if indent_of(nested_line) > indent {
                        nested.push_str(strip_indent_to(nested_line, indent + 2));
                        nested.push('\n');
                        i += 1;
                        continue;
                    }
                    break;
                }
                let children = if nested.trim().is_empty() {
                    Vec::new()
                } else {
                    markdown_to_blocks(&nested)
                };
                let mut props = style_props();
                if let Some(checked) = checked {
                    props.insert("checked".to_string(), Value::Bool(checked));
                }
                let mut item = block(kind, props, inline(content));
                if !children.is_empty() {
                    if let Some(object) = item.as_object_mut() {
                        object
                            .insert("children".to_string(), Value::Array(children));
                    }
                }
                blocks.push(item);
            }
            continue;
        }

        // Paragraph: consecutive lines until a blank or a block-level marker.
        let mut paragraph = vec![trimmed.to_string()];
        i += 1;
        while i < lines.len() {
            let next = lines[i].trim();
            if next.is_empty() || starts_special(next) {
                break;
            }
            paragraph.push(next.to_string());
            i += 1;
        }
        blocks.push(block(
            "paragraph",
            style_props(),
            inline(&paragraph.join("\n")),
        ));
    }
    blocks
}

// ── plain text + word count ─────────────────────────────────────────────────

/// Plain text of inline content — the Rust mirror of `docFormat.inlineText`.
fn inline_text(content: Option<&Value>) -> String {
    match content {
        None => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(text) => text.clone(),
                Value::Object(object) => {
                    if object.get("type").and_then(Value::as_str) == Some("link") {
                        inline_text(object.get("content"))
                    } else {
                        object
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string()
                    }
                }
                _ => String::new(),
            })
            .collect(),
        _ => String::new(),
    }
}

/// Plain text of a block array — the Rust mirror of `docFormat.blocksToText`.
pub(crate) fn blocks_plain_text(blocks: &[Value]) -> String {
    fn walk(blocks: &[Value], lines: &mut Vec<String>) {
        for block in blocks {
            let Some(object) = block.as_object() else {
                continue;
            };
            let line = if object.get("type").and_then(Value::as_str) == Some("mermaid") {
                inline_text(
                    object
                        .get("props")
                        .and_then(|props| props.get("code")),
                )
            } else {
                inline_text(object.get("content"))
            };
            if !line.is_empty() {
                lines.push(line);
            }
            if let Some(children) = object.get("children").and_then(Value::as_array) {
                walk(children, lines);
            }
        }
    }
    let mut lines = Vec::new();
    walk(blocks, &mut lines);
    lines.join("\n")
}

/// Plain text of a Markdown snippet.
pub(crate) fn markdown_plain_text(markdown: &str) -> String {
    blocks_plain_text(&markdown_to_blocks(markdown))
}

/// The CJK ranges `countDocumentWords` counts per character: Han, Hiragana,
/// Katakana and Hangul scripts.
fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{2E80}'..='\u{2FDF}'     // CJK radicals (Script=Han)
        | '\u{3005}'..='\u{3007}'   // iteration mark, ideographic marks
        | '\u{3400}'..='\u{4DBF}'   // CJK ext A
        | '\u{4E00}'..='\u{9FFF}'   // CJK unified ideographs
        | '\u{F900}'..='\u{FAFF}'   // CJK compatibility ideographs
        | '\u{20000}'..='\u{2FA1F}' // CJK ext B and beyond
        | '\u{3040}'..='\u{309F}'   // Hiragana
        | '\u{30A0}'..='\u{30FF}'   // Katakana
        | '\u{31F0}'..='\u{31FF}'   // Katakana phonetic extensions
        | '\u{FF66}'..='\u{FF9D}'   // halfwidth Katakana
        | '\u{1100}'..='\u{11FF}'   // Hangul Jamo
        | '\u{3130}'..='\u{318F}'   // Hangul compatibility Jamo
        | '\u{AC00}'..='\u{D7AF}'   // Hangul syllables
    )
}

fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || c.is_numeric() || c == '_'
}

fn is_word_joiner(c: char) -> bool {
    c == '\'' || c == '’' || c == '-'
}

/// Word count in the app's convention (`countDocumentWords`): every CJK
/// character counts as one word; the remaining text counts word-like runs,
/// with `'`/`’`/`-` joining a run when word characters follow. Markdown
/// structure (fences, markers, heading hashes) is dropped first, so the count
/// matches what the editor would show for the same body.
pub(crate) fn markdown_word_count(text: &str) -> i64 {
    let mut cjk = 0i64;
    let mut words = 0i64;
    let mut in_word = false;
    let mut joiner = false;
    for c in text.chars() {
        if is_cjk(c) {
            cjk += 1;
            in_word = false;
            joiner = false;
            continue;
        }
        if is_word_char(c) {
            if !in_word && !joiner {
                words += 1;
            }
            in_word = true;
            joiner = false;
            continue;
        }
        if is_word_joiner(c) && in_word {
            joiner = true;
            continue;
        }
        in_word = false;
        joiner = false;
    }
    cjk + words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types(blocks: &[Value]) -> Vec<String> {
        blocks
            .iter()
            .map(|b| b["type"].as_str().unwrap_or("").to_string())
            .collect()
    }

    #[test]
    fn parses_headings_paragraphs_and_dividers() {
        let blocks = markdown_to_blocks("# Title\n\nText with **bold**.\n\n---\n\n## Sub");
        assert_eq!(
            types(&blocks),
            vec!["heading", "paragraph", "divider", "heading"]
        );
        assert_eq!(blocks[0]["props"]["level"], serde_json::json!(1));
        let runs = blocks[1]["content"].as_array().unwrap();
        assert_eq!(runs[0]["text"], "Text with ");
        assert_eq!(runs[1]["text"], "bold");
        assert_eq!(runs[1]["styles"]["bold"], serde_json::json!(true));
        assert_eq!(runs[2]["text"], ".");
    }

    #[test]
    fn parses_inline_links_and_code() {
        let blocks = markdown_to_blocks("See [docs](https://example.com) and `code`");
        let runs = blocks[0]["content"].as_array().unwrap();
        assert_eq!(runs[0]["text"], "See ");
        assert_eq!(runs[1]["type"], "link");
        assert_eq!(runs[1]["href"], "https://example.com");
        assert_eq!(runs[1]["content"][0]["text"], "docs");
        assert_eq!(runs[2]["text"], " and ");
        assert_eq!(runs[3]["styles"]["code"], serde_json::json!(true));
    }

    #[test]
    fn unclosed_markers_stay_literal() {
        let blocks = markdown_to_blocks("2 ** 3 and * alone");
        let runs = blocks[0]["content"].as_array().unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["text"], "2 ** 3 and * alone");
    }

    #[test]
    fn parses_fenced_code() {
        let blocks = markdown_to_blocks("```rust\nfn main() {}\nlet x = 1;\n```");
        assert_eq!(types(&blocks), vec!["codeBlock"]);
        assert_eq!(blocks[0]["props"]["language"], "rust");
        let runs = blocks[0]["content"].as_array().unwrap();
        assert_eq!(runs[0]["text"], "fn main() {}\nlet x = 1;");
    }

    #[test]
    fn parses_lists_with_nesting_and_tasks() {
        let blocks = markdown_to_blocks(
            "- one\n- two\n  - nested\n- three\n1. first\n2. second\n- [ ] todo\n- [x] done",
        );
        assert_eq!(
            types(&blocks),
            vec![
                "bulletListItem",
                "bulletListItem",
                "bulletListItem",
                "numberedListItem",
                "numberedListItem",
                "checkListItem",
                "checkListItem"
            ]
        );
        assert_eq!(
            blocks[1]["children"][0]["type"],
            serde_json::json!("bulletListItem")
        );
        assert_eq!(
            blocks[1]["children"][0]["content"][0]["text"],
            serde_json::json!("nested")
        );
        assert_eq!(blocks[5]["props"]["checked"], serde_json::json!(false));
        assert_eq!(blocks[6]["props"]["checked"], serde_json::json!(true));
    }

    #[test]
    fn parses_quotes_and_lone_images() {
        let blocks = markdown_to_blocks("> quoted line\n> more\n\n![alt text](a.png)\n");
        assert_eq!(types(&blocks), vec!["quote", "image"]);
        let runs = blocks[0]["content"].as_array().unwrap();
        assert_eq!(runs[0]["text"], "quoted line\nmore");
        assert_eq!(blocks[1]["props"]["name"], "alt text");
        assert_eq!(blocks[1]["props"]["url"], "a.png");
    }

    #[test]
    fn multi_line_paragraphs_join() {
        let blocks = markdown_to_blocks("first line\nsecond line");
        assert_eq!(types(&blocks), vec!["paragraph"]);
        let runs = blocks[0]["content"].as_array().unwrap();
        assert_eq!(runs[0]["text"], "first line\nsecond line");
    }

    #[test]
    fn plain_text_mirrors_the_frontend_shape() {
        let blocks = markdown_to_blocks("# Head\n\nBody **text** here.\n\n- item one\n- item two");
        let text = blocks_plain_text(&blocks);
        assert_eq!(text, "Head\nBody text here.\nitem one\nitem two");
    }

    #[test]
    fn word_count_matches_the_frontend_convention() {
        assert_eq!(markdown_word_count("hello world"), 2);
        assert_eq!(markdown_word_count("don't stop"), 2);
        assert_eq!(markdown_word_count("mother-in-law"), 1);
        assert_eq!(markdown_word_count("你好世界"), 4);
        assert_eq!(markdown_word_count("abc你好"), 3);
        assert_eq!(markdown_word_count("word 50% off"), 3);
        assert_eq!(markdown_word_count(""), 0);
    }
}
