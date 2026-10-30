const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "FOOTER", "H1", "H2", "H3",
  "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
  "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

const OMIT_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
const HTML_TAG = /<\/?[a-z][^>]*>/i;
const HTML_ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i;

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (OMIT_TAGS.has(node.tagName)) return "";
  if (node.tagName === "BR") return "\n";

  const content = Array.from(node.childNodes, nodeText).join("");
  const prefix = node.tagName === "LI" ? "• " : "";
  return BLOCK_TAGS.has(node.tagName) ? `${prefix}${content}\n` : content;
}

/** Convert updater/GitHub release-note HTML into safe readable plain text.
 *  React still renders the result as a text node; this function never creates
 *  trusted HTML or uses dangerouslySetInnerHTML. Plain Markdown/text passes
 *  through unchanged apart from trimming. */
export function normalizeUpdateNotes(notes: string | null | undefined): string {
  let source = notes?.trim() ?? "";
  if (!source) return source;

  // electron-updater normally hands us decoded Atom content, but proxy/feed
  // variants can leave one or two entity layers around the HTML. Decode only
  // while the value is entity text rather than markup, then sanitize below.
  for (let layer = 0; layer < 2 && !HTML_TAG.test(source) && HTML_ENTITY.test(source); layer += 1) {
    const decoded = new DOMParser().parseFromString(source, "text/html").body.textContent ?? source;
    if (decoded === source) break;
    source = decoded;
  }
  if (!HTML_TAG.test(source)) return source;

  const parsed = new DOMParser().parseFromString(source, "text/html");
  return Array.from(parsed.body.childNodes, nodeText)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
