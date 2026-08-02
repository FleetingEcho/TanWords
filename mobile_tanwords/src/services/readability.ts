/**
 * Article reader extraction — mobile port of app/core/src/reader.rs (`fetch_article`).
 * Fetch + parse HTML with linkedom (no browser DOM in RN), extract with
 * @mozilla/readability, then apply the same cleaning the desktop did:
 * strip footnote back-reference arrows, sanitize the extracted HTML to the
 * desktop's allowlist, normalize textContent whitespace.
 */
import { Platform } from "react-native";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { viaCorsProxy, fetchedFinalUrl } from "@/lib/corsProxy";

export interface ExtractedArticle {
  /** Final URL after redirects (or the original when fetch didn't report one). */
  url: string;
  title: string;
  /** Plain-text article body; 3+ newlines collapsed, backrefs stripped. */
  textContent: string;
  /** Short excerpt or "" (desktop kept Option; empty string is the mobile "none"). */
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  /** Sanitized article HTML (desktop ammonia allowlist); null when extraction had none. */
  html: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;
/// Same cap as desktop `read_body_capped` — the parsed DOM cost scales with input size.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_ELEMS_TO_PARSE = 20_000;

/** Same allowlist as desktop `sanitize` in reader.rs (ammonia builder). */
const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre",
  "code", "img", "a", "strong", "em", "b", "i", "table", "thead", "tbody", "tr",
  "th", "td", "br", "figure", "figcaption",
]);

function sanitize(html: string): string {
  // linkedom fragment parsing drops nodes; a full-document wrapper is required.
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body;
  if (!body) return "";
  return sanitizeNodeChildren(body);
}

function sanitizeNodeChildren(node: { childNodes: ArrayLike<unknown> }): string {
  let out = "";
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i] as {
      nodeType: number;
      nodeValue?: string | null;
      tagName?: string;
      childNodes?: ArrayLike<unknown>;
      getAttribute?: (n: string) => string | null;
    };
    if (child.nodeType === 3 /* TEXT_NODE */) {
      out += escapeHtml(child.nodeValue ?? "");
      continue;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */ || !child.tagName) continue;
    const tag = child.tagName.toLowerCase();
    const inner = child.childNodes ? sanitizeNodeChildren({ childNodes: child.childNodes }) : "";
    if (!ALLOWED_TAGS.has(tag)) {
      out += inner; // unwrap, keep content
      continue;
    }
    if (tag === "br") {
      out += "<br>";
      continue;
    }
    let attrs = "";
    if (tag === "a") {
      const href = child.getAttribute?.("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        attrs = ` href="${escapeAttr(href)}" rel="noopener noreferrer nofollow"`;
      }
    } else if (tag === "img") {
      const src = child.getAttribute?.("src") ?? "";
      if (/^https?:\/\//i.test(src)) {
        attrs = ` src="${escapeAttr(src)}"`;
      }
    }
    out += `<${tag}${attrs}>${inner}</${tag}>`;
  }
  return out;
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/"/g, "&quot;");
}

/** Strip footnote back-reference arrows (↩ / ↩︎ with variation selectors) that
 *  Readability carries over from footnote sections. Desktop `strip_footnote_backrefs`. */
function stripFootnoteBackrefs(text: string): string {
  return text.replace(/\u21A9/g, "").replace(/\uFE0E/g, "").replace(/\uFE0F/g, "");
}

/** Desktop text_content normalization: trim and collapse 3+ newlines. */
function normalizeTextContent(text: string): string {
  return stripFootnoteBackrefs(text).replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    // Web: fetch via the dev server's same-origin CORS proxy (browsers can't
    // fetch 3rd-party article URLs cross-origin). User-Agent is a forbidden
    // header in browsers — the proxy sets an equivalent UA server-side.
    resp = await fetch(viaCorsProxy(url), {
      headers:
        Platform.OS === "web"
          ? { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
          : {
              "User-Agent": USER_AGENT,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    const reason = controller.signal.aborted ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : msg;
    throw new Error(`Request to ${url} failed: ${reason}`);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    throw new Error(`Server returned HTTP ${resp.status} for ${url}`);
  }

  // Capped read, mirroring desktop — a capped DOM is the cost-control point.
  let html: string;
  if (resp.body && typeof resp.body.getReader === "function") {
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          length += value.byteLength;
          if (length > MAX_BODY_BYTES) {
            await reader.cancel("body too large").catch(() => {});
            throw new Error(`Response body exceeded ${MAX_BODY_BYTES / (1024 * 1024)}MB cap`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    const buf = new Uint8Array(length);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    html = new TextDecoder("utf-8").decode(buf);
  } else {
    html = await resp.text();
    if (html.length > MAX_BODY_BYTES) {
      throw new Error(`Response body exceeded ${MAX_BODY_BYTES / (1024 * 1024)}MB cap`);
    }
  }

  return { html, finalUrl: fetchedFinalUrl(resp, url) };
}

/**
 * Fetch a page and extract its article content. Throws a descriptive Error on
 * request failure, non-2xx, or a page with no readable content.
 */
export async function fetchArticle(url: string): Promise<ExtractedArticle> {
  const { html: rawHtml, finalUrl } = await fetchHtml(url);

  // Readability resolves relative links/images against the document base URL.
  // linkedom reads baseURI from <base href>, which real pages often omit, so
  // inject one (desktop passed the URL straight into its Readability config).
  const html = /<base\s/i.test(rawHtml)
    ? rawHtml
    : rawHtml.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${escapeAttr(finalUrl)}">`);

  const { document } = parseHTML(html);

  const article = new Readability(document as unknown as Document, {
    maxElemsToParse: MAX_ELEMS_TO_PARSE,
  }).parse();

  if (!article) {
    throw new Error(`Could not extract article from ${finalUrl}`);
  }
  const textContent = normalizeTextContent(article.textContent ?? "");
  if (!textContent) {
    throw new Error(`No readable content found on this page: ${finalUrl}`);
  }

  return {
    url: finalUrl,
    title: (article.title ?? "").trim(),
    textContent,
    excerpt: article.excerpt?.trim() ?? "",
    byline: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || null,
    html: article.content ? sanitize(article.content) : null,
  };
}
