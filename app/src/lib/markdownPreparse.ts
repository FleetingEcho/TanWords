/** Repairs applied to markdown *before* BlockNote parses it, for shapes its
 *  parser drops on the floor. Shared by the main-thread parser (lib/docFormat)
 *  and the worker (workers/documentWorker) so both hosts see the same
 *  document — a fix applied to only one of them would show up as content that
 *  appears or vanishes depending on whether the worker was available. */

/** `[](https://…)` — a link with no label. BlockNote parses it to *nothing*:
 *  the link node carries its text as content, so an empty label leaves an
 *  empty paragraph and the URL is simply lost. It is a shape people write by
 *  hand and that AI assistants emit constantly, and losing the URL silently is
 *  the worst possible handling of it.
 *
 *  Using the URL as its own label is what a reader would do reading the source
 *  aloud, and it keeps every downstream rule working: a YouTube link on its
 *  own line still becomes a player (see mediaTransforms), because by then it
 *  is an ordinary labelled link.
 *
 *  Deliberately narrow: only an empty label, and only when the target is
 *  non-empty. `[]()` is left alone — there is nothing to recover. */
const EMPTY_LABEL_LINK = /\[\]\(\s*(<[^>\n]+>|[^()\s]+)(\s+"[^"]*")?\s*\)/g;

export function repairMarkdown(markdown: string): string {
  return markdown.replace(EMPTY_LABEL_LINK, (whole, target: string, title?: string) => {
    const url = target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;
    if (!url.trim()) return whole;
    return `[${url}](${target}${title ?? ""})`;
  });
}
