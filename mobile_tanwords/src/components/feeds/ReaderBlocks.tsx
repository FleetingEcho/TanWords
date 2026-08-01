/**
 * Sanitized article HTML → React Native blocks. No WebView anywhere; the input
 * is the allowlist-sanitized HTML from services/readability.ts (desktop
 * ammonia parity), so only semantic tags reach here. Rendering is typographic:
 * long-form text is selectable (word lookup / copy is core to this app),
 * links open in the system browser, images via expo-image.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { parseHTML } from "linkedom";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { tapHaptic, Divider } from "@/components/ui";
import { usePalette } from "@/lib/theme";

/* ---------- model ---------- */

type Inline =
  | { kind: "text"; text: string }
  | { kind: "br" }
  | { kind: "bold" | "italic" | "code"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "p"; inlines: Inline[] }
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "li"; ordered: boolean; index: number; depth: number; inlines: Inline[] }
  | { kind: "quote"; inlines: Inline[] } // flattened; nested blocks render as joined paragraphs
  | { kind: "pre"; text: string }
  | { kind: "image"; src: string; caption?: string }
  | { kind: "rule" };

/* ---------- walk ---------- */

type El = {
  nodeType: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes: ArrayLike<unknown>;
  getAttribute?: (n: string) => string | null;
  textContent?: string;
};

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre",
  "figure", "img", "table", "thead", "tbody", "tr", "td", "th", "hr", "div", "section", "article",
]);

function asEl(node: unknown): El {
  return node as El;
}

/** Collapse runs of whitespace; keep one leading/trailing space (join point
 *  between inline siblings decides whether to emit them). */
function cleanText(raw: string): string {
  return raw.replace(/[\t ]+/g, " ").replace(/\n+/g, "\n");
}

function collectInline(node: unknown, out: Inline[]): void {
  const el = asEl(node);
  if (el.nodeType === 3) {
    const text = cleanText(el.nodeValue ?? "");
    if (text.trim() !== "" || text === " ") out.push({ kind: "text", text });
    return;
  }
  if (el.nodeType !== 1 || !el.tagName) return;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") {
    out.push({ kind: "br" });
    return;
  }
  if (tag === "a") {
    const href = el.getAttribute?.("href") ?? "";
    const children: Inline[] = [];
    for (let i = 0; i < el.childNodes.length; i++) collectInline(el.childNodes[i], children);
    if (href && children.length > 0) out.push({ kind: "link", href, children });
    else out.push(...children);
    return;
  }
  if (tag === "strong" || tag === "b" || tag === "em" || tag === "i" || tag === "code") {
    const kind = tag === "strong" || tag === "b" ? "bold" : tag === "code" ? "code" : "italic";
    const children: Inline[] = [];
    for (let i = 0; i < el.childNodes.length; i++) collectInline(el.childNodes[i], children);
    out.push({ kind, children });
    return;
  }
  // Anything else inline-level: unwrap (sanitizer kept the text for us).
  for (let i = 0; i < el.childNodes.length; i++) collectInline(el.childNodes[i], out);
}

/** True when an element contains at least one block-level descendant. */
function hasBlockChildren(el: El): boolean {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = asEl(el.childNodes[i]);
    if (c.nodeType !== 1 || !c.tagName) continue;
    if (BLOCK_TAGS.has(c.tagName.toLowerCase())) return true;
  }
  return false;
}

function trimInlines(inlines: Inline[]): Inline[] {
  // Collapse duplicate whitespace at run boundaries.
  const joined = inlines.filter(
    (n, i) => !(n.kind === "text" && n.text.trim() === "" && (i === 0 || i === inlines.length - 1))
  );
  return joined;
}

function hasMeaningfulContent(inlines: Inline[]): boolean {
  return inlines.some(
    (n) => n.kind === "br" ? false : n.kind === "text" ? n.text.trim() !== "" : hasMeaningfulContent("children" in n && Array.isArray(n.children) ? n.children : [])
  );
}

function firstImage(el: El): string | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = asEl(el.childNodes[i]);
    if (c.nodeType !== 1 || !c.tagName) continue;
    if (c.tagName.toLowerCase() === "img") {
      const src = c.getAttribute?.("src") ?? "";
      if (src) return src;
    }
    const nested = firstImage(c);
    if (nested) return nested;
  }
  return null;
}

function figcaptionText(el: El): string {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = asEl(el.childNodes[i]);
    if (c.nodeType !== 1 || !c.tagName) continue;
    if (c.tagName.toLowerCase() === "figcaption") return (c.textContent ?? "").trim();
    const nested = figcaptionText(c);
    if (nested) return nested;
  }
  return "";
}

function walk(node: unknown, out: Block[]): void {
  const el = asEl(node);
  if (el.nodeType === 3) {
    const text = cleanText(el.nodeValue ?? "");
    if (text.trim() !== "") out.push({ kind: "p", inlines: [{ kind: "text", text: text.trim() }] });
    return;
  }
  if (el.nodeType !== 1 || !el.tagName) return;
  const tag = el.tagName.toLowerCase();

  if (tag === "hr") {
    out.push({ kind: "rule" });
    return;
  }
  if (tag === "img") {
    const src = el.getAttribute?.("src") ?? "";
    if (src) out.push({ kind: "image", src });
    return;
  }
  if (tag === "figure") {
    const src = firstImage(el);
    if (src) out.push({ kind: "image", src, caption: figcaptionText(el) || undefined });
    return;
  }
  if (tag === "pre") {
    const text = (el.textContent ?? "").replace(/\n+$/, "");
    if (text.trim()) out.push({ kind: "pre", text });
    return;
  }
  if (/^h[1-6]$/.test(tag)) {
    const inlines: Inline[] = [];
    for (let i = 0; i < el.childNodes.length; i++) collectInline(el.childNodes[i], inlines);
    if (hasMeaningfulContent(inlines)) {
      out.push({ kind: "heading", level: Number(tag[1]), inlines: trimInlines(inlines) });
    }
    return;
  }
  if (tag === "ul" || tag === "ol") {
    const ordered = tag === "ol";
    let idx = 0;
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = asEl(el.childNodes[i]);
      if (child.nodeType !== 1 || (child.tagName ?? "").toLowerCase() !== "li") continue;
      idx += 1;
      out.push(...liBlocks(child, ordered, idx, 0));
    }
    return;
  }
  if (tag === "blockquote") {
    if (hasBlockChildren(el)) {
      const inner: Block[] = [];
      for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i], inner);
      for (const b of inner) {
        if (b.kind === "p") out.push({ kind: "quote", inlines: b.inlines });
        else if (b.kind === "quote") out.push(b);
        else if (b.kind === "pre" || b.kind === "image") out.push(b); // keep as-is, rare
        else if (b.kind === "heading") out.push({ kind: "quote", inlines: b.inlines });
        else if (b.kind === "li") out.push({ kind: "quote", inlines: b.inlines });
        // rule → skip inside quotes
      }
    } else {
      const inlines: Inline[] = [];
      for (let i = 0; i < el.childNodes.length; i++) collectInline(el.childNodes[i], inlines);
      if (hasMeaningfulContent(inlines)) out.push({ kind: "quote", inlines: trimInlines(inlines) });
    }
    return;
  }
  if (tag === "table" || tag === "thead" || tag === "tbody" || tag === "tr" || tag === "td" || tag === "th") {
    // Sanitized tables: render each row as one muted line ("cell — cell").
    if (tag === "tr") {
      const cells: string[] = [];
      for (let i = 0; i < el.childNodes.length; i++) {
        const c = asEl(el.childNodes[i]);
        if (c.nodeType === 1) {
          const t = (c.textContent ?? "").replace(/\s+/g, " ").trim();
          if (t) cells.push(t);
        }
      }
      if (cells.length) {
        out.push({ kind: "p", inlines: [{ kind: "text", text: cells.join(" — ") }] });
      }
      return;
    }
    for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i], out);
    return;
  }
  if (tag === "li") {
    out.push(...liBlocks(el, false, 0, 0));
    return;
  }

  // p / div / section / article / body: if a block child exists, recurse; else a paragraph.
  if (tag === "p" || !hasBlockChildren(el)) {
    const inlines: Inline[] = [];
    for (let i = 0; i < el.childNodes.length; i++) collectInline(el.childNodes[i], inlines);
    if (hasMeaningfulContent(inlines)) out.push({ kind: "p", inlines: trimInlines(inlines) });
    return;
  }
  for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i], out);
}

/** `<li>` may itself contain nested lists — split inline lead + children. */
function liBlocks(el: El, ordered: boolean, index: number, depth: number): Block[] {
  const out: Block[] = [];
  const inlines: Inline[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = asEl(el.childNodes[i]);
    if (c.nodeType === 1 && c.tagName && (c.tagName.toLowerCase() === "ul" || c.tagName.toLowerCase() === "ol")) {
      const tag = c.tagName.toLowerCase();
      let idx = 0;
      for (let j = 0; j < c.childNodes.length; j++) {
        const g = asEl(c.childNodes[j]);
        if (g.nodeType === 1 && (g.tagName ?? "").toLowerCase() === "li") {
          idx += 1;
          out.push(...liBlocks(g, tag === "ol", idx, depth + 1));
        }
      }
    } else {
      collectInline(c, inlines);
    }
  }
  const trimmed = trimInlines(inlines);
  if (hasMeaningfulContent(trimmed)) {
    out.unshift({ kind: "li", ordered, index, depth, inlines: trimmed });
  }
  return out;
}

/** Parse sanitized article HTML into renderable blocks. */
export function htmlToBlocks(html: string): Block[] {
  // Full-document wrapper — linkedom drops nodes when parsing bare fragments.
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body;
  if (!body) return [];
  const out: Block[] = [];
  for (let i = 0; i < body.childNodes.length; i++) walk(body.childNodes[i], out);
  return out;
}

/** Headings cite xref noise aside, pull body paragraphs out of a fallback text. */
export function textToBlocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ kind: "p", inlines: [{ kind: "text", text: p.replace(/\n/g, " ") }] }) as Block);
}

/* ---------- render ---------- */

function renderInline(nodes: Inline[], keyPrefix: string, size: number, linkColor: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const sizeStyle = { fontSize: size };
  nodes.forEach((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.kind) {
      case "text":
        out.push(n.text);
        break;
      case "br":
        out.push("\n");
        break;
      case "bold":
        out.push(
          <Text key={key} style={[sizeStyle, { fontWeight: "700" }]}>
            {renderInline(n.children, key, size, linkColor)}
          </Text>
        );
        break;
      case "italic":
        out.push(
          <Text key={key} style={[sizeStyle, { fontStyle: "italic" }]}>
            {renderInline(n.children, key, size, linkColor)}
          </Text>
        );
        break;
      case "code":
        out.push(
          <Text key={key} className="bg-muted" style={[sizeStyle, { fontFamily: "Menlo", borderRadius: 4 }]}>
            {renderInline(n.children, key, size, linkColor)}
          </Text>
        );
        break;
      case "link":
        out.push(
          <Text
            key={key}
            style={[sizeStyle, { color: linkColor, textDecorationLine: "underline" }]}
            onPress={() => {
              tapHaptic();
              void WebBrowser.openBrowserAsync(n.href).catch(() => {});
            }}
          >
            {renderInline(n.children, key, size, linkColor)}
          </Text>
        );
        break;
    }
  });
  return out;
}

export function ReaderBlocks({ blocks, compact = false }: { blocks: Block[]; compact?: boolean }) {
  const p = usePalette();
  const bodySize = compact ? 14 : 16;
  const bodyClass = compact ? "text-[14px] leading-6" : "text-[16px] leading-7";
  return (
    <View>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "p":
            return (
              <Text key={key} selectable className={`${bodyClass} mb-3 mt-1 text-foreground`}>
                {renderInline(b.inlines, key, bodySize, p.primary)}
              </Text>
            );
          case "heading": {
            const cls =
              b.level <= 2
                ? `text-[20px] font-bold leading-7 mb-2 mt-4 ${compact ? "text-[17px]" : ""} text-foreground`
                : `text-[17px] font-semibold leading-6 mb-2 mt-3 ${compact ? "text-[15px]" : ""} text-foreground`;
            return (
              <Text key={key} selectable className={cls}>
                {renderInline(b.inlines, key, b.level <= 2 ? 20 : 17, p.primary)}
              </Text>
            );
          }
          case "li":
            return (
              <View key={key} className="mb-1.5 flex-row" style={{ paddingLeft: 4 + b.depth * 16 }}>
                <Text selectable className={`${bodyClass} w-6 text-muted-foreground`}>
                  {b.ordered ? `${b.index}.` : "•"}
                </Text>
                <Text selectable className={`${bodyClass} flex-1 text-foreground`}>
                  {renderInline(b.inlines, key, bodySize, p.primary)}
                </Text>
              </View>
            );
          case "quote":
            return (
              <View key={key} className="mb-3 rounded-r-lg border-l-4 border-border bg-muted px-3 py-2">
                <Text selectable className={`${bodyClass} text-muted-foreground`}>
                  {renderInline(b.inlines, key, bodySize, p.primary)}
                </Text>
              </View>
            );
          case "pre":
            return (
              <View key={key} className="mb-3 rounded-lg bg-muted p-3">
                <Text selectable style={{ fontFamily: "Menlo", fontSize: 13, lineHeight: 19 }} className="text-foreground">
                  {b.text}
                </Text>
              </View>
            );
          case "image":
            return (
              <View key={key} className="my-3">
                <Image
                  source={{ uri: b.src }}
                  style={{ width: "100%", height: 220, borderRadius: 12 }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={120}
                />
                {b.caption ? (
                  <Text className="mt-1.5 text-center text-[12px] text-muted-foreground">{b.caption}</Text>
                ) : null}
              </View>
            );
          case "rule":
            return <Divider key={key} className="my-4" />;
          default:
            return null;
        }
      })}
    </View>
  );
}

/** Small inline-styled renderer for HN comment HTML (sanitized by services/hn). */
export function CommentBlocks({ html }: { html: string }) {
  const blocks = htmlToBlocks(html);
  return <ReaderBlocks blocks={blocks} compact />;
}
