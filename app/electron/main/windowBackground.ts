/** The colour the window itself is painted before the renderer paints anything.
 *
 *  A BrowserWindow with no `backgroundColor` defaults to white. `show: false`
 *  plus `ready-to-show` hides most of that, but not all: the window's own
 *  compositing layer is still white underneath the page, so the first frame
 *  (and every resize before the renderer catches up) flashed white on a dark
 *  theme.
 *
 *  index.html already solves the equivalent problem *inside* the page, by
 *  reading a cached theme from localStorage before first paint. Main can't
 *  read localStorage, so the renderer reports its resolved background colour
 *  here (see `applyTheme`) and we keep it in userData for the next launch —
 *  the same cache-then-authoritative-source pattern, one level down.
 *
 *  Only the *previous* run's colour is available at window-creation time, which
 *  is exactly right: a theme almost never changes between quitting and
 *  relaunching, and if it does, the one stale frame is still far closer than
 *  white. */
import { app, nativeTheme } from "electron";
import fs from "node:fs";
import path from "node:path";

/** `--background` of the default dark and light themes, resolved to hex
 *  (styles/theme-vars.css: `222 16% 10%` and `220 25% 97%`). Used only until
 *  the renderer has reported a real colour once. */
const DARK_FALLBACK = "#15181e";
const LIGHT_FALLBACK = "#f5f7f9";

/** Hex, rgb() or rgba(). Anything else is rejected rather than handed to
 *  Electron, which throws on a colour string it can't parse and would take
 *  window creation down with it. */
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.,\s%/]+\))$/;

function cacheFile(): string {
  return path.join(app.getPath("userData"), "window-background.json");
}

export function rememberedWindowBackground(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), "utf-8")) as { color?: unknown };
    if (typeof parsed.color === "string" && COLOR_RE.test(parsed.color)) return parsed.color;
  } catch {
    // First launch, or the file is unreadable/corrupt — fall through to the
    // OS preference, which is right for the default "system" theme.
  }
  return nativeTheme.shouldUseDarkColors ? DARK_FALLBACK : LIGHT_FALLBACK;
}

export function rememberWindowBackground(color: unknown): void {
  if (typeof color !== "string" || !COLOR_RE.test(color)) return;
  if (color === lastWritten) return;
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify({ color }), "utf-8");
    lastWritten = color;
  } catch {
    // Non-fatal: the next launch just falls back to the OS preference.
  }
}

/** Theme changes re-report the same colour repeatedly (applyTheme runs on every
 *  settings load); skip the write when nothing changed. */
let lastWritten: string | null = null;
