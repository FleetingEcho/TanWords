import { invoke } from "@tauri-apps/api/core";

export interface HnComment {
  id: number;
  by: string | null;
  text: string;
  time: number | null;
  children: HnComment[];
}

export function fetchHnComments(storyId: number): Promise<HnComment[]> {
  return invoke<HnComment[]>("fetch_hn_comments", { storyId });
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&#39;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Flattens a comment tree into plain text for the "native usage" analysis prompt —
 *  capped so a mega-thread doesn't blow the prompt's token budget. */
export function flattenHnComments(comments: HnComment[], maxChars = 6000): string {
  const lines: string[] = [];
  let total = 0;
  const walk = (list: HnComment[]) => {
    for (const c of list) {
      if (total >= maxChars) return;
      const plain = stripHtml(c.text);
      if (plain) {
        lines.push(`- ${plain}`);
        total += plain.length;
      }
      walk(c.children);
    }
  };
  walk(comments);
  return lines.join("\n");
}
