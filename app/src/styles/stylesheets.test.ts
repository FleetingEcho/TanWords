/**
 * Stylesheet hygiene after the editor migration.
 *
 * `reader-content.css` kept styling `.bn-editor` long after that element
 * stopped existing, so the reader silently lost its 68ch measure and picked up
 * the document editor's much wider column instead — a layout bug no behavioural
 * test can see, because jsdom does not lay anything out.
 *
 * Dead selectors are cheap to detect and were the actual cause, so detect them.
 */
/// <reference types="node" />
import { describe, it, expect } from "vitest";
// Read from disk rather than imported: vitest runs with `css: false`, so a
// stylesheet import (even `?raw`) resolves to an empty string.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES_DIR = dirname(fileURLToPath(import.meta.url));

function stylesheets(): { name: string; css: string }[] {
  const sheets = readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => ({ name, css: readFileSync(join(STYLES_DIR, name), "utf8") }));
  return [
    { name: "index.css", css: readFileSync(join(STYLES_DIR, "..", "index.css"), "utf8") },
    ...sheets,
  ];
}

const readerCss = readFileSync(join(STYLES_DIR, "reader-content.css"), "utf8");
const tiptapCss = readFileSync(join(STYLES_DIR, "tiptap-editor.css"), "utf8");
const rawMarkdownCss = readFileSync(join(STYLES_DIR, "raw-markdown-editor.css"), "utf8");
const themeCss = readFileSync(join(STYLES_DIR, "theme-vars.css"), "utf8");

describe("Tokyo Night palette", () => {
  const tokyoNight = themeCss.slice(
    themeCss.indexOf(".theme-tokyo-night {"),
    themeCss.indexOf("/* Tokyo Night Day */"),
  );

  it("keeps a bright layered canvas and blue accent", () => {
    expect(tokyoNight).toContain("--background: 232 24% 16%");
    expect(tokyoNight).toContain("--card: 230 27% 20%");
    expect(tokyoNight).toContain("--sidebar: 234 25% 12%");
    expect(tokyoNight).toContain("--primary: 213 100% 72%");
    expect(tokyoNight).toContain("--muted-foreground: 226 32% 68%");
  });

  it("defines Tokyo Night syntax colours for the raw editor", () => {
    expect(tokyoNight).toContain("--syntax-keyword: #bb9af7");
    expect(tokyoNight).toContain("--syntax-string: #9ece6a");
    expect(tokyoNight).toContain("--syntax-comment: #565f89");
  });
});

describe("no styles target the removed editor", () => {
  it.each(stylesheets())("$name has no .bn-* selectors", ({ css }) => {
    // Comments may still mention the old editor as history; selectors may not.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const matches = withoutComments.match(/\.bn-[\w-]+/g) ?? [];
    expect(matches).toEqual([]);
  });

  it.each(stylesheets())("$name declares no --bn-* custom properties", ({ css }) => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments.match(/--bn-[\w-]+\s*:/g) ?? []).toEqual([]);
  });
});

describe("the reader keeps its own measure", () => {
  const reader = readerCss;

  it("caps the article column at the reading measure", () => {
    expect(reader).toContain("max-width: 68ch");
  });

  it("gives the header the same measure, so the title lines up with the text", () => {
    const headerRule = reader.slice(reader.indexOf(".reader-article-header"));
    expect(headerRule.slice(0, 260)).toContain("max-width: 68ch");
  });

  it("styles the live editor root rather than a class that no longer exists", () => {
    expect(reader).toContain(".ProseMirror");
  });
});

describe("the scroll-past-the-end gutter is editing-only", () => {
  const editor = tiptapCss;

  it("keys the tall bottom padding on contenteditable", () => {
    // Applied unconditionally it left the reader ending in a blank screen.
    const rule = editor.slice(editor.indexOf('[contenteditable="true"]'));
    expect(rule).toContain("padding-bottom: 40vh");
  });

  it("does not put 40vh in the base padding", () => {
    const base = editor.slice(0, editor.indexOf('[contenteditable="true"]'));
    expect(base).not.toContain("40vh");
  });
});

describe("the document editor uses the compact shell width", () => {
  const compact = tiptapCss.slice(tiptapCss.indexOf("@media (max-width: 1023px)"));

  it("reduces editable document padding without changing read-only articles", () => {
    expect(compact).toContain('.ProseMirror[contenteditable="true"]');
    expect(compact).toContain("max-width: none");
    expect(compact).toContain("margin-inline: 0");
    expect(compact).toContain("padding-left: 1rem");
    expect(compact).toContain("padding-right: 1rem");
  });

  it("hides the desktop hover gutter throughout compact mode", () => {
    expect(compact).toContain("[data-drag-handle-wrapper]");
    expect(compact).toContain("display: none !important");
  });
});

describe("the raw Markdown editor uses the compact shell width", () => {
  const compact = rawMarkdownCss.slice(rawMarkdownCss.indexOf("@media (max-width: 1023px)"));

  it("removes both independent centring layers", () => {
    expect(compact).toContain(".raw-markdown-editor-frame");
    expect(compact).toContain(".raw-markdown-editor-measure");
    expect(compact).toContain("max-width: none");
    expect(compact).toContain("margin-inline: 0");
  });

  it("uses small outer and CodeMirror content insets", () => {
    expect(compact).toContain("padding-inline: 1rem");
    expect(compact).toContain("--raw-markdown-content-inset: 0.5rem");
  });
});
