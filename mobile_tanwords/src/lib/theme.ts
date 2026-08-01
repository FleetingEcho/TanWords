/**
 * Theme tokens + hooks. Ports the desktop light/dark palettes
 * (app/src/styles/theme-vars.css :root / .dark) 1:1.
 *
 * How it fits together:
 *  - tailwind.config.js maps semantic colors to `hsl(var(--…))`.
 *  - app/_layout.tsx injects the triplet values once at the root via
 *    NativeWind `vars(themeVars[name])`, so `bg-background`, `text-foreground`
 *    etc. resolve per-theme everywhere below it.
 *  - Non-className consumers (icons, tab bar, StatusBar) use `usePalette()`,
 *    which returns fully-formed `hsl(...)` strings.
 */
import { useColorScheme } from "react-native";
import { useSettingsStore, type ThemeMode } from "@/store/settingsStore";

export type ThemeName = "light" | "dark";

/** Raw HSL triplets ("H S% L%") — identical values to desktop theme-vars.css. */
const LIGHT = {
  background: "220 25% 97%",
  foreground: "222 24% 14%",
  card: "0 0% 100%",
  "card-foreground": "222 24% 14%",
  popover: "0 0% 100%",
  "popover-foreground": "222 24% 14%",
  primary: "226 68% 51%",
  "primary-foreground": "0 0% 100%",
  secondary: "220 20% 94%",
  "secondary-foreground": "222 16% 28%",
  muted: "220 18% 94%",
  "muted-foreground": "220 10% 43%",
  accent: "226 65% 94%",
  "accent-foreground": "226 60% 42%",
  destructive: "0 72% 51%",
  "destructive-foreground": "0 0% 100%",
  border: "220 16% 86%",
  input: "220 16% 82%",
  ring: "226 68% 51%",
  ink: "211 65% 40%",
} as const;

const DARK: Record<keyof typeof LIGHT, string> = {
  background: "222 16% 10%",
  foreground: "210 20% 92%",
  card: "222 16% 13%",
  "card-foreground": "210 20% 92%",
  popover: "222 16% 13%",
  "popover-foreground": "210 20% 92%",
  primary: "243 75% 65%",
  "primary-foreground": "0 0% 100%",
  secondary: "222 14% 18%",
  "secondary-foreground": "210 20% 75%",
  muted: "222 14% 18%",
  "muted-foreground": "215 12% 55%",
  accent: "243 50% 20%",
  "accent-foreground": "243 75% 75%",
  destructive: "0 62% 55%",
  "destructive-foreground": "0 0% 100%",
  border: "222 14% 20%",
  input: "222 14% 20%",
  ring: "243 75% 65%",
  ink: "210 55% 70%",
};

export type TokenKey = keyof typeof LIGHT;

/** Object shaped for NativeWind `vars()` — inject at the root View style. */
export function themeVars(name: ThemeName): Record<string, string> {
  const src = name === "dark" ? DARK : LIGHT;
  const out: Record<string, string> = {};
  for (const k of Object.keys(src)) out[`--${k}`] = src[k as TokenKey];
  return out;
}

/** Resolve the effective theme from the user's stored preference + OS. */
export function useThemeName(): ThemeName {
  const mode: ThemeMode = useSettingsStore((s) => s.themeMode);
  const system = useColorScheme();
  if (mode === "light" || mode === "dark") return mode;
  return system === "dark" ? "dark" : "light";
}

export type Palette = Record<TokenKey, string>;

const cache: Partial<Record<ThemeName, Palette>> = {};
/** Fully-formed `hsl(...)` strings — concrete colors for icon props etc. */
export function getPalette(name: ThemeName): Palette {
  if (!cache[name]) {
    const src = name === "dark" ? DARK : LIGHT;
    const out = {} as Record<string, string>;
    for (const k of Object.keys(src)) out[k] = `hsl(${src[k as TokenKey]})`;
    cache[name] = out as Palette;
  }
  return cache[name]!;
}

export function usePalette(): Palette {
  return getPalette(useThemeName());
}
