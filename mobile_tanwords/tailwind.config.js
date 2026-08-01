/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Desktop app token names (app/src/index.css) so classNames port 1:1.
        background: "hsl(0 0% 100%)",
        foreground: "hsl(240 10% 4%)",
        muted: "hsl(240 5% 96%)",
        "muted-foreground": "hsl(240 4% 46%)",
        primary: "hsl(243 75% 59%)",
        destructive: "hsl(0 84% 60%)",
        border: "hsl(240 6% 90%)",
        card: "hsl(0 0% 100%)",
      },
    },
  },
  plugins: [],
};
