/** Calendar colour categories → CSS hex colours for FullCalendar's
 *  `event.color` property.
 *
 *  The DB stores a stable `color_name` token (blue, green, …) rather than a
 *  hex value so a theme change re-tints every event without a write, and so two
 *  users sharing a Postgres DB don't see each other's hand-picked hexes clash.
 *  This module is the single source of truth for the token→colour mapping both
 *  at render time (FullCalendar event fills) and in the picker (swatches). */

export const CALENDAR_COLOR_TOKENS = [
  "blue",
  "green",
  "red",
  "yellow",
  "purple",
  "pink",
  "orange",
  "teal",
  "gray",
] as const;

export type CalendarColorToken = (typeof CALENDAR_COLOR_TOKENS)[number];

export function isColorToken(token: string): token is CalendarColorToken {
  return (CALENDAR_COLOR_TOKENS as readonly string[]).includes(token);
}

interface ColorDef {
  /** Vivid colour used as the FullCalendar event background (light theme).
   *  Dark enough that white event text stays legible. */
  light: string;
  /** Brighter colour for dark theme, so events pop against a dark surface.
   *  Light enough that dark event text stays legible. */
  dark: string;
  /** A mid-tone representative swatch for the sidebar list, independent of the
   *  active theme (the dot shows the same colour in light and dark). */
  swatch: string;
}

// Palette adapted from the previous Schedule-X defaults: each entry pairs a
// vivid `light` (event fill in light theme) with a brighter `dark` (event fill
// in dark theme) and a theme-neutral `swatch` (sidebar dot).
export const COLOR_DEFINITIONS: Record<CalendarColorToken, ColorDef> = {
  blue:   { light: "#1d4ed8", dark: "#60a5fa", swatch: "#1d4ed8" },
  green:  { light: "#15803d", dark: "#4ade80", swatch: "#15803d" },
  red:    { light: "#b91c1c", dark: "#f87171", swatch: "#b91c1c" },
  yellow: { light: "#a16207", dark: "#facc15", swatch: "#a16207" },
  purple: { light: "#7e22ce", dark: "#c084fc", swatch: "#7e22ce" },
  pink:   { light: "#be185d", dark: "#f472b6", swatch: "#be185d" },
  orange: { light: "#c2410c", dark: "#fb923c", swatch: "#c2410c" },
  teal:   { light: "#0f766e", dark: "#2dd4bf", swatch: "#0f766e" },
  gray:   { light: "#475569", dark: "#94a3b8", swatch: "#475569" },
};

/** A stable token → the CSS hex colour FullCalendar should use as the event's
 *  `color` (background fill). Falls back to blue for an unknown token. */
export function colorTokenToHex(token: string, isDark: boolean): string {
  const def = COLOR_DEFINITIONS[isColorToken(token) ? token : "blue"];
  return isDark ? def.dark : def.light;
}

/** A stable token → a theme-neutral mid-tone for the sidebar dot. */
export function colorTokenToSwatch(token: string): string {
  const def = COLOR_DEFINITIONS[isColorToken(token) ? token : "blue"];
  return def.swatch;
}

/** For FullCalendar's dark-theme events, the dark palette colours are light
 *  enough that white text is hard to read — use a dark text colour. In light
 *  theme the vivid fills pair well with white text. */
export function colorTokenToTextColor(token: string, isDark: boolean): string {
  return isDark ? "#1e293b" : "#ffffff";
}
