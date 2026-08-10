/** Colors for tag chips, derived from the tag name alone so the same tag is
 *  the same color in every theme — no schema, no per-tag config.
 *
 *  We use a *hue* and let lightness/alpha come from the theme (`--tag-chip-l`,
 *  light vs dark), and mix the chip fill into the active theme's background via
 *  `color-mix`. This is what keeps tags legible across the app's eight themes;
 *  a hardcoded `bg-red-500` collides with Catppuccin, Dracula, Tokyo Night etc.
 */
const TAG_HUES = [4, 28, 45, 140, 190, 220, 265, 320]; // red…violet

/** djb2 hash of the tag bucketed into the hand-picked, evenly-spaced hues, so
 *  two adjacent tags never land on near-identical colors the way `hash % 360`
 *  can. */
export function tagHue(tag: string): number {
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) + hash + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_HUES[hash % TAG_HUES.length];
}
