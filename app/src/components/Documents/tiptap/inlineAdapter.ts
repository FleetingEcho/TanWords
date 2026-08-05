/**
 * Inline content ⇄ ProseMirror inline nodes.
 *
 * Our format nests link text inside a `link` node; ProseMirror models a link
 * as a *mark* on ordinary text runs. Converting both ways is therefore not
 * symmetric: going out, a run of adjacent text sharing one `href` collapses
 * back into a single `link` node, or every character would become its own.
 */
import type { InlineContent, InlineStyles, TextInline } from "./blocks";

interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmInline {
  type: "text";
  text: string;
  marks?: PmMark[];
}

/** Style flag ⇄ mark name. Identical today, but named so the two vocabularies
 *  stay decoupled — a schema rename must not silently change stored content. */
const STYLE_MARKS: Record<keyof InlineStyles, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
};

function stylesToMarks(styles: InlineStyles | undefined): PmMark[] {
  if (!styles) return [];
  return (Object.keys(STYLE_MARKS) as (keyof InlineStyles)[])
    .filter((style) => styles[style])
    .map((style) => ({ type: STYLE_MARKS[style] }));
}

function marksToStyles(marks: PmMark[] | undefined): InlineStyles {
  const styles: InlineStyles = {};
  for (const mark of marks ?? []) {
    for (const [style, name] of Object.entries(STYLE_MARKS)) {
      if (mark.type === name) styles[style as keyof InlineStyles] = true;
    }
  }
  return styles;
}

function linkHref(marks: PmMark[] | undefined): string | null {
  const link = (marks ?? []).find((mark) => mark.type === "link");
  return link ? String(link.attrs?.href ?? "") : null;
}

/**
 * Inline content → ProseMirror inline nodes.
 *
 * A plain string is accepted as shorthand for one unstyled run. Block literals
 * written by hand use it constantly (see `BlockTemplatesMenu`), and it is part
 * of the stored format's `content` type. Without this the string is *iterated*
 * — yielding characters, none of which have a `.text` — so every block comes
 * out empty, which is exactly what a broken template looks like.
 */
export function inlineToPm(content: InlineContent[] | string | undefined): PmInline[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  const out: PmInline[] = [];
  for (const part of content ?? []) {
    if (part.type === "link") {
      const href = part.href ?? "";
      for (const child of part.content ?? []) {
        // An empty text run is not representable in ProseMirror and would make
        // the whole document fail to parse, taking the editor with it.
        if (!child.text) continue;
        out.push({
          type: "text",
          text: child.text,
          marks: [...stylesToMarks(child.styles), { type: "link", attrs: { href } }],
        });
      }
      continue;
    }
    if (!part.text) continue;
    const marks = stylesToMarks(part.styles);
    out.push(marks.length ? { type: "text", text: part.text, marks } : { type: "text", text: part.text });
  }
  return out;
}

/** ProseMirror inline nodes → inline content, re-collapsing link runs. */
export function pmToInline(nodes: PmInline[] | undefined): InlineContent[] {
  const out: InlineContent[] = [];
  for (const node of nodes ?? []) {
    if (node.type !== "text" || !node.text) continue;
    const href = linkHref(node.marks);
    const text: TextInline = { type: "text", text: node.text, styles: marksToStyles(node.marks) };
    if (href === null) {
      out.push(text);
      continue;
    }
    // Adjacent runs under the same href belong to one link, not several.
    const previous = out[out.length - 1];
    if (previous?.type === "link" && previous.href === href) {
      previous.content.push(text);
    } else {
      out.push({ type: "link", href, content: [text] });
    }
  }
  return out;
}

/** Plain text of inline content, used where only the words matter. */
export function inlineText(content: InlineContent[] | string | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? [])
    .map((part) => (part.type === "link" ? inlineText(part.content) : part.text))
    .join("");
}
