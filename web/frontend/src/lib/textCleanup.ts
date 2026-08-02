/** Collapses runs of 2+ blank lines (including whitespace-only ones) down to a
 *  single blank line. For machine-extracted text (article bodies, scraped
 *  comments) where source markup often leaves long vertical gaps that add no
 *  content — never apply this to text the user typed themselves. */
export function collapseBlankLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
