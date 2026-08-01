/**
 * Hacker News API — mobile port of app/core/src/hn.rs. Same endpoints:
 * ranked sections via the official Firebase API, story search via Algolia,
 * threaded comments via the official API with a shared budget + depth cap.
 * Comment text is sanitized to the same allowlist ammonia used in Rust.
 *
 * Exported names are camelCase (searchHn / fetchHnSection / fetchHnComments);
 * field names match the desktop serde output exactly: HnSearchPage keeps
 * `total_pages` (no rename in hn.rs) and comment/story fields keep snake_case
 * none → all plain words, so both match.
 */

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Same caps as the desktop: mega-threads can't stall the UI. */
const MAX_COMMENTS = 300;
const MAX_DEPTH = 6;
const MAX_CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS = 15_000;

export interface HnComment {
  id: number;
  by: string | null;
  /** Sanitized HTML (allowlist: p,i,em,b,strong,a,pre,code,blockquote,br). */
  text: string;
  time: number | null;
  children: HnComment[];
}

export interface HnStorySummary {
  id: number;
  title: string;
  /** Story link; Ask-HN-style text posts fall back to the discussion page. */
  url: string;
  by: string | null;
  score: number | null;
  time: number | null;
  descendants: number | null;
}

export interface HnSectionPage {
  stories: HnStorySummary[];
  total: number;
}

export interface HnSearchPage {
  stories: HnStorySummary[];
  page: number;
  total_pages: number; // eslint-disable-line camelcase -- matches desktop serde output
}

export type HnSection = "new" | "top" | "best";

const HN_SECTIONS: Record<HnSection, string> = {
  new: "newstories",
  top: "topstories",
  best: "beststories",
};

interface HnItemRaw {
  id: number;
  by?: string | null;
  text?: string | null;
  time?: number | null;
  kids?: number[] | null;
  deleted?: boolean | null;
  dead?: boolean | null;
  title?: string | null;
  url?: string | null;
  score?: number | null;
  descendants?: number | null;
}

/* ---------- small shared helpers ---------- */

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Server returned HTTP ${resp.status} for ${url}`);
    }
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Deleted/flagged items come back as bare JSON null. */
async function fetchItem(id: number): Promise<HnItemRaw | null> {
  const parsed = await fetchJson(`${HN_API_BASE}/item/${id}.json`);
  return parsed as HnItemRaw | null;
}

async function fetchIdList(endpoint: string): Promise<number[]> {
  const parsed = await fetchJson(`${HN_API_BASE}/${endpoint}.json`);
  return Array.isArray(parsed) ? (parsed as number[]) : [];
}

/* ---------- comment HTML sanitization (ammonia allowlist parity) ---------- */

const ALLOWED_TAGS = new Set(["p", "i", "em", "b", "strong", "a", "pre", "code", "blockquote", "br"]);

/** Whitelist-based sanitizer mirroring ammonia's builder on the desktop.
 *  Keeps allowed tags (with `rel="noopener noreferrer nofollow"` on links),
 *  unwraps anything else but keeps its text, escapes entities. */
function sanitizeComment(html: string): string {
  const decoded = decodeEntities(html);
  let out = "";
  let i = 0;
  while (i < decoded.length) {
    const lt = decoded.indexOf("<", i);
    if (lt === -1) {
      out += escapeHtml(decoded.slice(i));
      break;
    }
    out += escapeHtml(decoded.slice(i, lt));
    const gt = decoded.indexOf(">", lt);
    if (gt === -1) {
      out += escapeHtml(decoded.slice(lt));
      break;
    }
    const tag = decoded.slice(lt + 1, gt);
    const m = /^\s*(\/?)\s*([a-zA-Z0-9]+)/.exec(tag);
    if (!m) {
      i = gt + 1;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (ALLOWED_TAGS.has(name)) {
      if (name === "br") {
        out += "<br>";
      } else if (name === "a") {
        if (closing) {
          out += "</a>";
        } else {
          const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
          const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? "";
          const safe = /^https?:\/\//i.test(href);
          out += safe
            ? `<a href="${escapeAttr(href)}" rel="noopener noreferrer nofollow">`
            : "<a>";
        }
      } else {
        out += closing ? `</${name}>` : `<${name}>`;
      }
    }
    // Disallowed tags are unwrapped: their inner text is still emitted,
    // matching ammonia's default behavior (keep content, drop the element).
    i = gt + 1;
  }
  return out;
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
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name: string) =>
      name === "nbsp"
        ? " "
        : name === "amp"
          ? "&"
          : name === "lt"
            ? "<"
            : name === "gt"
              ? ">"
              : name === "quot"
                ? '"'
                : "'"
    );
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/"/g, "&quot;");
}

/* ---------- concurrency pool ---------- */

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

/* ---------- public API ---------- */

/**
 * One page of a ranked HN section ("new" | "top" | "best"), mirroring
 * `fetch_hn_section`. The id list is re-fetched per call, so live ranking
 * drift is the same trade-off as the desktop.
 */
export async function fetchHnSection(
  section: HnSection,
  offset: number,
  limit: number
): Promise<HnSectionPage> {
  const endpoint = HN_SECTIONS[section];
  if (!endpoint) throw new Error(`Unknown HN section: ${section}`);
  const ids = await fetchIdList(endpoint);
  const total = ids.length;
  const start = Math.max(0, Math.min(offset, total));
  const end = Math.max(start, Math.min(start + Math.max(0, limit), total));
  const slice = ids.slice(start, end);

  const stories = await mapLimit(slice, MAX_CONCURRENCY, async (id): Promise<HnStorySummary | null> => {
    const item = await fetchItem(id).catch(() => null);
    if (!item || item.deleted || item.dead) return null;
    return {
      id: item.id,
      title: item.title ?? "",
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      by: item.by ?? null,
      score: item.score ?? null,
      time: item.time ?? null,
      descendants: item.descendants ?? null,
    };
  });

  return { stories: stories.filter((s): s is HnStorySummary => s !== null), total };
}

/** Algolia story search, mirroring `search_hn`. */
export async function searchHn(query: string, page: number): Promise<HnSearchPage> {
  if (!query.trim()) {
    return { stories: [], page: 0, total_pages: 0 };
  }
  const params = new URLSearchParams({
    query,
    tags: "story",
    page: String(Math.max(0, page)),
  });
  const parsed = (await fetchJson(`${ALGOLIA_SEARCH_URL}?${params.toString()}`)) as {
    hits?: Array<{
      objectID?: string;
      title?: string | null;
      url?: string | null;
      author?: string | null;
      points?: number | null;
      created_at_i?: number | null;
      num_comments?: number | null;
    }> | null;
    page?: number;
    nbPages?: number;
  } | null;

  const stories: HnStorySummary[] = (parsed?.hits ?? [])
    .map((hit): HnStorySummary | null => {
      const id = Number(hit.objectID);
      if (!Number.isInteger(id) || id <= 0) return null;
      return {
        id,
        title: hit.title ?? "",
        url: hit.url ?? `https://news.ycombinator.com/item?id=${id}`,
        by: hit.author ?? null,
        score: hit.points ?? null,
        time: hit.created_at_i ?? null,
        descendants: hit.num_comments ?? null,
      };
    })
    .filter((s): s is HnStorySummary => s !== null);

  return {
    stories,
    page: parsed?.page ?? Math.max(0, page),
    total_pages: parsed?.nbPages ?? 0,
  };
}

/** Threaded comments for a story, mirroring `fetch_hn_comments`. */
export async function fetchHnComments(storyId: number): Promise<HnComment[]> {
  const story = await fetchItem(storyId);
  if (!story) throw new Error("Story not found");
  const kids = story.kids ?? [];
  let budget = MAX_COMMENTS;

  async function fetchTree(id: number, depth: number): Promise<HnComment | null> {
    if (budget <= 0) return null;
    const item = await fetchItem(id).catch(() => null);
    if (!item || item.deleted || item.dead) return null;
    const text = item.text;
    if (!text) return null; // no body (e.g. a poll option)
    budget -= 1;

    let children: HnComment[] = [];
    if (depth < MAX_DEPTH && item.kids && item.kids.length > 0) {
      const childResults = await mapLimit(item.kids, MAX_CONCURRENCY, (kid) =>
        fetchTree(kid, depth + 1)
      );
      children = childResults.filter((c): c is HnComment => c !== null);
    }

    return {
      id: item.id,
      by: item.by ?? null,
      text: sanitizeComment(text),
      time: item.time ?? null,
      children,
    };
  }

  const topLevel = await mapLimit(kids, MAX_CONCURRENCY, (kid) => fetchTree(kid, 0));
  return topLevel.filter((c): c is HnComment => c !== null);
}
