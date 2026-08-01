/** @type {import('tailwindcss').Config} */
// Semantic colors resolve through CSS variables injected at the app root
// (NativeWind `vars()`, see src/lib/theme.ts + app/_layout.tsx). Values are
// the desktop app's theme-vars.css HSL triplets, so dark mode and any future
// theme port over with zero className changes.
const v = (name) => `hsl(var(--${name}))`;

module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: v("background"),
        foreground: v("foreground"),
        card: { DEFAULT: v("card"), foreground: v("card-foreground") },
        popover: { DEFAULT: v("popover"), foreground: v("popover-foreground") },
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground") },
        secondary: { DEFAULT: v("secondary"), foreground: v("secondary-foreground") },
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        destructive: { DEFAULT: v("destructive"), foreground: v("destructive-foreground") },
        border: v("border"),
        input: v("input"),
        ring: v("ring"),
        ink: v("ink"),
      },
    },
  },
  plugins: [],
};
