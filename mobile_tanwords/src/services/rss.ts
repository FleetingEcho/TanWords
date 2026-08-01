/**
 * RSS/Atom fetching + parsing — the mobile replacement for the desktop Rust
 * fetcher (app/core/src/rss/parse.rs), which used reqwest + feed-rs. Plain
 * global `fetch` (SDK 57 installs expo/fetch) + fast-xml-parser; entry
 * normalization mirrors the desktop rules.
 *
 * One intentional addition over the desktop shape: `hnItemId` on entries,
 * extracted from hnrss.org-style `<guid>https://news.ycombinator.com/item?id=N`
 * — the desktop does this in Rust (`extract_hn_item_id`) and the DB has an
 * `hn_item_id` column, so the sync layer would otherwise have nothing to store.
 */
import { XMLParser } from "fast-xml-parser";

export interface ParsedEntry {
  title: string;
  /** http(s) only; "" when the entry has no usable web link. */
  url: string;
  author: string;
  /** Plain text, tags stripped, whitespace collapsed, <= ~500 chars. */
  summary: string;
  imageUrl: string | null;
  /** ISO 8601 best-effort from pubDate/published/updated/dc:date; "" fallback. */
  published: string;
  /** Podcast enclosure (direct audio URL); null for regular article entries. */
  audioUrl: string | null;
  /** Episode length in seconds, when the feed provides it. */
  audioDuration: number | null;
  hnItemId: number | null;
}

export interface ParsedFeed {
  title: string;
  siteLink: string;
  description: string;
  /** True when any entry carries an audio enclosure (feeds list groups those under "Podcasts"). */
  isPodcast: boolean;
  entries: ParsedEntry[];
}

/// Same browser UA the desktop Rust fetchers send (app/core/src/rss/parse.rs).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;
/// Same cap as desktop `read_body_capped` — a "feed" is remote-controlled
/// content and the XML parser amplifies it, so don't stream unbounded data.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
/// Desktop keeps at most 50 newest entries per fetch.
const MAX_ENTRIES = 50;
const SUMMARY_MAX_CHARS = 500;

const AUDIO_EXT = new Set(["mp3", "m4a", "wav", "ogg", "aac", "flac"]);
const NON_IMAGE_EXT = new Set(["mp3", "mp4", "m4a", "wav", "mov", "pdf", "zip", "ogg", "webm"]);

function httpOnly(url: URL): string | null {
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}

/** Resolve a possibly-relative URL against a page/feed base (desktop `resolve_url`). */
function resolveUrl(raw: string, base: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return httpOnly(new URL(trimmed));
  } catch {
    // not absolute — try resolving against the base
  }
  try {
    return httpOnly(new URL(trimmed, base));
  } catch {
    return null;
  }
}

/** First `<img src="...">` in an HTML fragment (desktop `first_img_src`). */
function firstImgSrc(html: string): string | null {
  const lower = html.toLowerCase();
  let searchFrom = 0;
  while (true) {
    const rel = lower.indexOf("<img", searchFrom);
    if (rel === -1) return null;
    const tagEnd = lower.indexOf(">", rel);
    if (tagEnd === -1) return null;
    const tag = html.slice(rel, tagEnd);
    const srcPos = tag.toLowerCase().indexOf("src=");
    if (srcPos !== -1) {
      const after = tag.slice(srcPos + 4);
      const quote = after.charAt(0);
      if (quote === '"' || quote === "'") {
        // JS indexOf gives an ABSOLUTE index (Rust searched after[1..] and got
        // a relative one), so slice(1, end) is the faithful port.
        const end = after.indexOf(quote, 1);
        if (end !== -1) return after.slice(1, end);
      }
    }
    searchFrom = tagEnd + 1;
  }
}

function pathExtension(urlStr: string): string {
  const last = urlStr.split(".").pop() ?? "";
  if (last === urlStr) return ""; // no dot at all — extensionless
  return last
    .split(/[?#]/)[0]
    .toLowerCase();
}

/** Extensionless URLs (common for CMS image links) are treated as images. */
function looksLikeNonImage(urlStr: string): boolean {
  return NON_IMAGE_EXT.has(pathExtension(urlStr));
}

function looksLikeAudioPath(urlStr: string): boolean {
  return AUDIO_EXT.has(pathExtension(urlStr));
}

/** Desktop `strip_html`: remove tags and decode the entities feeds actually use. */
function stripHtml(input: string): string {
  let out = "";
  let inTag = false;
  for (const c of input) {
    if (c === "<") inTag = true;
    else if (c === ">") inTag = false;
    else if (!inTag) out += c;
  }
  return decodeEntities(out).trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      const cp = parseInt(n, 16);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
      } catch {
        return "";
      }
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name: string) => {
      switch (name) {
        case "nbsp":
          return " ";
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return "";
      }
    });
}

function makeSummary(html: string): string {
  const text = stripHtml(html).replace(/\s+/g, " ").trim();
  return text.length > SUMMARY_MAX_CHARS
    ? text.slice(0, SUMMARY_MAX_CHARS).replace(/\s+\S*$/, "").trimEnd()
    : text;
}

/** ISO 8601 best-effort; "" when the feed's date is missing or unparsable. */
function normalizeDate(...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t)) {
      try {
        return new Date(t).toISOString();
      } catch {
        // fall through
      }
    }
  }
  return "";
}

/** `itunes:duration` as number | "MM:SS" | "HH:MM:SS" → whole seconds (desktop `itunes_duration_to_seconds`). */
function parseItunesDuration(raw: string): number | null {
  const parts = raw
    .trim()
    .split(":")
    .map((p) => p.trim());
  if (parts.length === 0 || parts.length > 3) return null;
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    // Ints and floats both valid ("90.5"); everything else isn't.
    if (!/^\d+(\.\d+)?$/.test(parts[i])) return null;
    const value = Number(parts[i]);
    const multiplier =
      parts.length === 1 ? 1 : parts.length === 2 ? (i === 0 ? 60 : 1) : i === 0 ? 3600 : i === 1 ? 60 : 1;
    seconds += value * multiplier;
  }
  return seconds > 0 ? Math.round(seconds) : null;
}

/** hnrss.org-style guid → HN item id (desktop `extract_hn_item_id`). */
function extractHnItemId(id: string): number | null {
  const prefixes = [
    "https://news.ycombinator.com/item?id=",
    "http://news.ycombinator.com/item?id=",
  ];
  for (const p of prefixes) {
    if (id.startsWith(p)) {
      const rest = id.slice(p.length).split(/[&#]/)[0];
      const n = Number(rest);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  }
  return null;
}

/* ---------- fast-xml-parser normalization helpers ---------- */

type XNode = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Element text where an element carrying attributes parses to `{ "#text": ..., "@_…": ... }`. */
function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const t = (value as XNode)["#text"];
    return textOf(t);
  }
  return "";
}

function attrOf(value: unknown, name: string): string {
  if (value !== null && typeof value === "object") {
    const a = (value as XNode)[`@_${name}`];
    if (a !== undefined && a !== null) return String(a);
  }
  return "";
}

/** Element text that should keep basic entities intact for HTML stripping — i.e. raw content. */
function rawContentOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return rawContentOf((value as XNode)["#text"]);
  return "";
}

/* ---------- RSS 2.0 ---------- */

function rssItemNode(item: XNode, ...names: string[]): unknown {
  for (const n of names) {
    if (item[n] !== undefined) return item[n];
  }
  return undefined;
}

function parseRssEntries(channel: XNode, siteLink: string): ParsedEntry[] {
  return asArray(channel.item as XNode | XNode[] | undefined)
    .filter((item): item is XNode => item !== null && typeof item === "object")
    .slice(0, MAX_ENTRIES)
    .map((item) => {
      const description = rawContentOf(rssItemNode(item, "description"));
      const contentEncoded = rawContentOf(rssItemNode(item, "content:encoded"));
      // feed-rs: summary = description; content:encoded is the full body (image fallback source).
      const bodyHtml = contentEncoded || description;

      // Entry link; some feeds use <guid isPermaLink="true">URL</guid> instead.
      let link = textOf(rssItemNode(item, "link"));
      if (!link) {
        const guid = rssItemNode(item, "guid");
        const guidText = textOf(guid);
        if (guidText && (guidText.startsWith("http://") || guidText.startsWith("https://"))) {
          const perma = attrOf(guid, "isPermaLink");
          if (perma === "" || perma.toLowerCase() === "true") link = guidText;
        }
      }

      const href = link.trim();
      const pageUrl = href || siteLink;

      // Audio: first enclosure with audio/* type or audio-looking extension.
      let audioUrl: string | null = null;
      for (const enc of asArray(rssItemNode(item, "enclosure"))) {
        const encUrl = attrOf(enc, "url");
        if (!encUrl) continue;
        const type = attrOf(enc, "type").toLowerCase();
        if (type.startsWith("audio/") || looksLikeAudioPath(encUrl)) {
          audioUrl = resolveUrl(encUrl, pageUrl);
          break;
        }
      }

      // Duration: itunes:duration (any of number / MM:SS / HH:MM:SS).
      let audioDuration: number | null = null;
      const durationRaw = textOf(rssItemNode(item, "itunes:duration"));
      if (durationRaw) audioDuration = parseItunesDuration(durationRaw);

      // Image: itunes:image/@_href | media:thumbnail/@_url | media:content (image type /
      // non-media extension) | first <img> in body | first <img> in description.
      let imageRaw = "";
      const itunesImage = rssItemNode(item, "itunes:image");
      const itunesHref = attrOf(itunesImage, "href") || attrOf(itunesImage, "url");
      if (itunesHref) imageRaw = itunesHref;
      if (!imageRaw) {
        const thumb = attrOf(asArray(rssItemNode(item, "media:thumbnail"))[0], "url");
        if (thumb) imageRaw = thumb;
      }
      if (!imageRaw) {
        for (const mc of asArray(rssItemNode(item, "media:content"))) {
          const mcUrl = attrOf(mc, "url");
          if (!mcUrl) continue;
          const medium = attrOf(mc, "medium").toLowerCase();
          const type = attrOf(mc, "type").toLowerCase();
          if (medium === "image" || type.startsWith("image/") || (!medium && !looksLikeNonImage(mcUrl))) {
            imageRaw = mcUrl;
            break;
          }
        }
      }
      const imageUrl =
        (imageRaw ? resolveUrl(imageRaw, pageUrl) : null) ??
        (() => {
          const fromBody = bodyHtml ? firstImgSrc(bodyHtml) : null;
          const raw = fromBody ?? (description ? firstImgSrc(description) : null);
          return raw ? resolveUrl(raw, pageUrl) : null;
        })();

      const guidText = textOf(rssItemNode(item, "guid"));
      const isPermaLink = attrOf(rssItemNode(item, "guid"), "isPermaLink").toLowerCase();
      const hnItemId =
        extractHnItemId(guidText) ?? (isPermaLink !== "false" ? extractHnItemId(href) : null);

      return {
        title: textOf(rssItemNode(item, "title")),
        url: resolveUrl(href, "") ?? "",
        author:
          textOf(rssItemNode(item, "author")) ||
          textOf(rssItemNode(item, "itunes:author")) ||
          textOf(rssItemNode(item, "dc:creator")),
        summary: makeSummary(description || bodyHtml),
        imageUrl,
        published: normalizeDate(
          textOf(rssItemNode(item, "pubDate")) || undefined,
          textOf(rssItemNode(item, "dc:date")) || undefined,
          textOf(rssItemNode(item, "published")) || undefined,
          textOf(rssItemNode(item, "updated")) || undefined,
          textOf(rssItemNode(item, "dc:Date")) || undefined
        ),
        audioUrl,
        audioDuration,
        hnItemId,
      };
    });
}

/* ---------- Atom ---------- */

function atomLinkHref(link: unknown, relWanted: string): string {
  const links = asArray(link);
  let first = "";
  for (const l of links) {
    const href = attrOf(l, "href") || textOf(l);
    if (!href) continue;
    const rel = (attrOf(l, "rel") || "alternate").toLowerCase();
    if (rel === relWanted) return href;
    if (!first) first = href;
  }
  // Desktop feed-rs keeps only page links; fall back to the first link so we
  // still have a page URL for resolving relative images.
  return first;
}

function atomPersons(value: unknown): string {
  const people = asArray(value as XNode | XNode[] | undefined);
  const person = people.find((p) => p !== null && typeof p === "object");
  return person ? textOf((person as XNode).name) : "";
}

function parseAtomEntries(feed: XNode, siteLink: string): ParsedEntry[] {
  return asArray(feed.entry as XNode | XNode[] | undefined)
    .filter((e): e is XNode => e !== null && typeof e === "object")
    .slice(0, MAX_ENTRIES)
    .map((entry) => {
      const href = atomLinkHref(entry.link, "alternate");
      const pageUrl = href || siteLink;

      let audioUrl: string | null = null;
      for (const l of asArray(entry.link)) {
        if (attrOf(l, "rel").toLowerCase() !== "enclosure") continue;
        const encUrl = attrOf(l, "href") || textOf(l);
        if (!encUrl) continue;
        const type = attrOf(l, "type").toLowerCase();
        if (type.startsWith("audio/") || looksLikeAudioPath(encUrl)) {
          audioUrl = resolveUrl(encUrl, pageUrl);
          break;
        }
      }

      const durationRaw = textOf(entry["itunes:duration"]);
      const audioDuration = durationRaw ? parseItunesDuration(durationRaw) : null;

      let imageRaw = "";
      const itunesImage = entry["itunes:image"];
      const itunesHref = attrOf(itunesImage, "href") || attrOf(itunesImage, "url");
      if (itunesHref) imageRaw = itunesHref;
      if (!imageRaw) {
        const thumb = attrOf(asArray(entry["media:thumbnail"])[0], "url");
        if (thumb) imageRaw = thumb;
      }
      if (!imageRaw) {
        for (const mc of asArray(entry["media:content"])) {
          const mcUrl = attrOf(mc, "url");
          if (!mcUrl) continue;
          const medium = attrOf(mc, "medium").toLowerCase();
          const type = attrOf(mc, "type").toLowerCase();
          if (medium === "image" || type.startsWith("image/") || (!medium && !looksLikeNonImage(mcUrl))) {
            imageRaw = mcUrl;
            break;
          }
        }
      }

      const contentHtml = rawContentOf(entry.content);
      const summaryHtml = rawContentOf(entry.summary);
      const imageUrl =
        (imageRaw ? resolveUrl(imageRaw, pageUrl) : null) ??
        (() => {
          const raw =
            (contentHtml ? firstImgSrc(contentHtml) : null) ??
            (summaryHtml ? firstImgSrc(summaryHtml) : null);
          return raw ? resolveUrl(raw, pageUrl) : null;
        })();

      // Desktop: summary only when <summary> exists; falls back to <content>
      // only when it's plain text (html/xhtml content is the article body).
      const contentType = attrOf(entry.content, "type").toLowerCase();
      const summarySource =
        summaryHtml ||
        (contentHtml && (contentType === "" || contentType === "text" || contentType === "text/plain")
          ? contentHtml
          : "");

      const idText = textOf(entry.id);

      return {
        title: textOf(entry.title),
        url: resolveUrl(href, "") ?? "",
        author: atomPersons(entry.author),
        summary: makeSummary(summarySource),
        imageUrl,
        published: normalizeDate(
          textOf(entry.published) || undefined,
          textOf(entry.updated) || undefined,
          textOf(entry["dc:date"]) || undefined
        ),
        audioUrl,
        audioDuration,
        hnItemId: extractHnItemId(idText) ?? extractHnItemId(href),
      };
    });
}

/* ---------- fetch + cap + dispatch ---------- */

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function getWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, redirect: "follow", signal: controller.signal });
  } catch (e) {
    const reason = controller.signal.aborted ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : errorMessage(e);
    throw new Error(`Request to ${url} failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Body read capped at MAX_BODY_BYTES (desktop `read_body_capped`). */
async function readTextCapped(resp: Response): Promise<string> {
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
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(buf);
  }
  // Streamless environments (bun/node sanity runs): read whole, check after.
  const text = await resp.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error(`Response body exceeded ${MAX_BODY_BYTES / (1024 * 1024)}MB cap`);
  }
  return text;
}

/**
 * Fetch and parse an RSS 2.0 or Atom feed. Throws a descriptive Error on
 * network failure, non-2xx status, or a document with no channel/feed root.
 */
export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
  const resp = await getWithTimeout(url, { "User-Agent": USER_AGENT });
  const location = resp.url || url;
  if (!resp.ok) {
    throw new Error(`Server returned HTTP ${resp.status} for ${location}`);
  }
  const body = await readTextCapped(resp);

  let root: XNode;
  try {
    root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(body, true) as XNode;
  } catch (e) {
    throw new Error(`Feed parse error for ${location}: ${errorMessage(e)}`);
  }

  const rss = root?.rss as XNode | undefined;
  const rdf = root?.["rdf:RDF"] as XNode | undefined;
  const atom = root?.feed as XNode | undefined;

  if (rss?.channel || rdf?.channel) {
    const container = rss ?? (rdf as XNode);
    const channel = container.channel as XNode;
    // RSS 1.0 (RDF) keeps items outside <channel>, as siblings.
    const itemSource: XNode =
      channel.item !== undefined ? channel : { ...channel, item: container.item };
    const siteLink = textOf(channel.link);
    const entries = parseRssEntries(itemSource, siteLink);
    return {
      title: textOf(channel.title),
      siteLink,
      description: textOf(channel.description),
      isPodcast: entries.some((e) => e.audioUrl !== null),
      entries,
    };
  }

  if (atom && typeof atom === "object") {
    const siteLink = atomLinkHref(atom.link, "alternate");
    const entries = parseAtomEntries(atom, siteLink);
    return {
      title: textOf(atom.title),
      siteLink,
      description: textOf(atom.subtitle) || textOf(atom.tagline),
      isPodcast: entries.some((e) => e.audioUrl !== null),
      entries,
    };
  }

  throw new Error(`Not an RSS or Atom feed (no <channel>/<feed> found): ${location}`);
}
