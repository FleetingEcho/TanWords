/** Deterministic gradient "album art" for a collection name — same name
 * always renders the same cover, no assets needed. */

export interface CoverGradient {
  /** CSS background-image value (two-stop linear gradient). */
  css: string;
  /** The gradient's dominant hue, for accents that should match the cover. */
  hue: number;
}

/** FNV-1a — tiny, stable across sessions/platforms. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function coverGradient(name: string): CoverGradient {
  const h = hashString(name);
  const hue = h % 360;
  // Offset the second hue by 40–100° so every cover reads as a two-tone
  // blend rather than a flat wash, and vary the angle per name.
  const hue2 = (hue + 40 + ((h >>> 9) % 61)) % 360;
  const angle = (h >>> 17) % 360;
  const from = `hsl(${hue} 65% 62%)`;
  const to = `hsl(${hue2} 70% 40%)`;
  return { css: `linear-gradient(${angle}deg, ${from}, ${to})`, hue };
}
