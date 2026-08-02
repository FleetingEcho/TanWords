import { DEFAULT_BANNER_POSITION, DEFAULT_HIGHLIGHT_COLOR, DOCUMENT_TEXT_COLOR_RE, type BannerPosition, type Theme } from "./types";

/** Installs that predate the drag-to-position banner have no stored framing — and
 *  their banners were baked as centre crops, so centre is also the honest fallback. */
export function parseBannerPosition(raw: unknown): BannerPosition {
  const pos = raw as Partial<BannerPosition> | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return DEFAULT_BANNER_POSITION;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return { x: clamp(pos.x), y: clamp(pos.y) };
}

/** Pushes the chosen colour into the two custom properties <mark> reads (see
 *  index.css). The background is the same colour at 20% alpha via an 8-digit
 *  hex rather than color-mix()/hsl-slash, so it works on every WebView version
 *  Tauri ships against. A malformed stored value falls back to the default
 *  instead of writing an invalid property that would silently disable
 *  highlights. */
export function applyHighlightColor(hex: string) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_HIGHLIGHT_COLOR;
  const root = document.documentElement;
  root.style.setProperty("--highlight", safe);
  root.style.setProperty("--highlight-bg", `${safe}33`);
}

export function applyDocumentFontSize(px: number) {
  document.documentElement.style.setProperty("--document-font-size", `${px}px`);
}

export function applyDocumentLineHeight(value: number) {
  document.documentElement.style.setProperty("--document-line-height", String(value));
}

export function applyDocumentTextColor(hex: string) {
  if (DOCUMENT_TEXT_COLOR_RE.test(hex)) {
    document.documentElement.style.setProperty("--document-text-color", hex);
  } else {
    document.documentElement.style.removeProperty("--document-text-color");
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove(
    "theme-catppuccin-latte",
    "theme-catppuccin-mocha",
    "theme-dracula",
    "theme-tokyo-night",
    "theme-tokyo-night-day",
    "theme-tokyo-night-storm",
    "theme-dim",
  );
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle(
      "dark",
      theme !== "light" && theme !== "catppuccin-latte" && theme !== "tokyo-night-day",
    );
    if (theme === "catppuccin-latte") root.classList.add("theme-catppuccin-latte");
    if (theme === "catppuccin-mocha") root.classList.add("theme-catppuccin-mocha");
    if (theme === "dracula") root.classList.add("theme-dracula");
    if (theme === "tokyo-night") root.classList.add("theme-tokyo-night");
    if (theme === "tokyo-night-day") root.classList.add("theme-tokyo-night-day");
    if (theme === "tokyo-night-storm") root.classList.add("theme-tokyo-night-storm");
    if (theme === "dim") root.classList.add("theme-dim");
  }
  // Cached so index.html's pre-paint script can apply it synchronously on
  // the next launch, before the async DB round-trip resolves.
  try {
    localStorage.setItem("tanwords_theme_cache", theme);
  } catch {
    // localStorage unavailable — the DB-driven applyTheme() call still runs, just later
  }
}

