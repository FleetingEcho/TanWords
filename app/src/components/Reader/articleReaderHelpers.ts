export interface FetchedArticle {
  title: string;
  byline: string | null;
  site_name: string | null;
  content_html: string;
  text_content: string;
  excerpt: string | null;
}

export const FONT_STEPS = [15, 16, 17.5, 19, 21] as const;

/** URLs of the form `paste:<n>` have nothing to fetch — the reader opens
 *  straight into its paste box and builds the article from what you drop in.
 *  See components/Reader/ReadingPage.tsx. */
export const SCRATCH_URL_PREFIX = "paste:";

/** `library:<id>` opens an article already saved in the reading library —
 *  same reader, same tools, no network. */
export const LIBRARY_URL_PREFIX = "library:";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The title for a pasted article when the learner didn't write one. A
 *  pasted article usually leads with its own title, so the first line is
 *  used when it reads like one; otherwise the opening words stand in. Never
 *  a generic label like "Pasted" — that's what every entry in the library
 *  would end up called. */
function titleFromPastedText(text: string, explicit: string): string {
  if (explicit.trim()) return explicit.trim();
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "";
  if (first.length <= 120) return first;
  return first.slice(0, 60).replace(/\s+\S*$/, "") + "…";
}

/** Turns a plain-text paste into the same shape `fetch_article` returns, so the rest of
 *  the reader (font size, TTS, translation, notes) doesn't need to know the source. */
export function articleFromPastedText(text: string, title: string): FetchedArticle {
  const content_html = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
  return {
    title: titleFromPastedText(text, title),
    byline: null,
    site_name: "",
    content_html,
    text_content: text,
    excerpt: null,
  };
}
