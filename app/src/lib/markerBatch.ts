export interface MarkedItem {
  key: string;
  text: string;
}

/** Serializes a batch of texts into one prompt-ready block, each preceded by a
 *  @@key@@ marker, so a single AI call can translate the whole batch and the
 *  response can be split back apart into per-item results afterwards — instead
 *  of firing one request per item (e.g. one per comment, or one per HN title). */
export function serializeMarkedBatch(items: MarkedItem[]): string {
  return items.map((i) => `@@${i.key}@@\n${i.text}`).join("\n\n");
}

/** Reverses serializeMarkedBatch. Tolerant of stray content before the first
 *  marker or extra whitespace; an item whose marker didn't survive translation
 *  just won't appear in the map (callers fall back to the original text for it). */
export function parseMarkedBatch(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = raw.split(/@@([\w:-]+)@@/).slice(1);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    map.set(parts[i], parts[i + 1].trim());
  }
  return map;
}
