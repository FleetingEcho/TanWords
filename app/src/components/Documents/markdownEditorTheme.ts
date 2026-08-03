import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** Colours for the raw-Markdown editor, carried over from the GitHub Dark /
 *  Light palettes the document editor's code blocks already use, so a fenced
 *  block looks the same whether you are reading it in the rendered document or
 *  editing its source.
 *
 *  Set here rather than pulled from a published CodeMirror theme because the
 *  surrounding chrome — background, gutter, selection — has to come from the
 *  app's own theme variables, and a theme that brought its own would leave the
 *  editor looking like a panel from a different program. */
const PALETTE = {
  dark: {
    heading: "#79B8FF",
    quote: "#8B949E",
    link: "#79B8FF",
    code: "#9ECBFF",
    keyword: "#F97583",
    string: "#9ECBFF",
    comment: "#6A737D",
    number: "#79B8FF",
    fn: "#B392F0",
    variable: "#E1E4E8",
    punctuation: "#8B949E",
  },
  light: {
    heading: "#005CC5",
    quote: "#6A737D",
    link: "#032F62",
    code: "#032F62",
    keyword: "#D73A49",
    string: "#032F62",
    comment: "#6A737D",
    number: "#005CC5",
    fn: "#6F42C1",
    variable: "#24292E",
    punctuation: "#6A737D",
  },
};

function highlightStyle(dark: boolean) {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return HighlightStyle.define([
    // ── Markdown itself ──────────────────────────────────────────────────
    { tag: tags.heading, color: c.heading, fontWeight: "bold" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.quote, color: c.quote, fontStyle: "italic" },
    { tag: [tags.link, tags.url], color: c.link, textDecoration: "underline" },
    { tag: tags.monospace, color: c.code },
    { tag: tags.list, color: c.punctuation },
    // The `#`, `**`, backticks and so on. Dimmed rather than coloured: they
    // are scaffolding, and the text they wrap is what you are reading.
    { tag: tags.processingInstruction, color: c.punctuation },
    { tag: tags.contentSeparator, color: c.punctuation },

    // ── Languages inside fenced blocks ───────────────────────────────────
    { tag: tags.comment, color: c.comment, fontStyle: "italic" },
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword], color: c.keyword },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: c.string },
    { tag: [tags.number, tags.bool, tags.null], color: c.number },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className], color: c.fn },
    { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: c.variable },
    { tag: [tags.typeName, tags.namespace], color: c.heading },
    { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: c.punctuation },
    { tag: tags.invalid, color: dark ? "#F97583" : "#D73A49" },
  ]);
}

/** Chrome — everything that is not a token. All of it reads from the app's
 *  theme variables so the editor stays part of the app rather than a widget
 *  dropped into it. */
const chrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    color: "var(--document-text-color, hsl(var(--foreground)))",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.75",
    padding: "1.25rem 0",
  },
  ".cm-content": { padding: "0 1.5rem", caretColor: "hsl(var(--foreground))" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--muted) / 0.15)",
    color: "hsl(var(--muted-foreground) / 0.4)",
    border: "none",
    paddingRight: "0.5rem",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "hsl(var(--muted-foreground))" },
  ".cm-activeLine": { backgroundColor: "hsl(var(--muted) / 0.25)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "hsl(var(--foreground))" },
  // Every additional cursor Ctrl+D adds shows up here — without a visible
  // secondary caret, multi-select looks like the selection simply moved.
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "hsl(var(--primary) / 0.28)",
  },
  ".cm-selectionMatch": { backgroundColor: "hsl(var(--primary) / 0.14)" },
  ".cm-searchMatch": {
    backgroundColor: "hsl(var(--primary) / 0.22)",
    outline: "1px solid hsl(var(--primary) / 0.5)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "hsl(var(--primary) / 0.45)" },
  // No `.cm-panel` styling here on purpose: the library's find panel is never
  // opened. Find and replace is MarkdownSearchBar, built from the app's own
  // controls — which is why this file does not have to guess at markup it does
  // not own.
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    color: "hsl(var(--foreground))",
  },
});

export function markdownEditorTheme(dark: boolean): Extension {
  return [chrome, syntaxHighlighting(highlightStyle(dark))];
}
