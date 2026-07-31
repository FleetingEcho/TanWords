import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = resolve(import.meta.dirname, "../src");

/** Guards the fix for a silent build regression: Tailwind's PostCSS plugin
 *  inlines @import itself without rebasing relative url()s onto the importing
 *  file. While index.css pulled fonts.css in that way, the @font-face
 *  `url("../static/…")` paths resolved against src/ instead of src/styles/, so
 *  Vite emitted no woff2 at all and the packaged app fell back to system fonts
 *  — nothing failed until an `electron-builder` run logged four
 *  ERR_FILE_NOT_FOUND. None of it is visible in `vite dev`, hence the test.
 *
 *  This lives outside src/ because it reads files off disk: it is an assertion
 *  about the build wiring, not about anything the renderer does at runtime. */
describe("font assets survive the build", () => {
  it("keeps fonts.css out of index.css's @import graph", () => {
    const indexCss = readFileSync(resolve(src, "index.css"), "utf8");
    expect(indexCss).not.toMatch(/@import\s+['"]\.\/styles\/fonts\.css['"]/);
  });

  it("loads fonts.css from TS instead, so Vite treats it as its own module", () => {
    const mainTsx = readFileSync(resolve(src, "main.tsx"), "utf8");
    expect(mainTsx).toMatch(/import\s+['"]\.\/styles\/fonts\.css['"]/);
  });

  it("points every @font-face at a file that exists", () => {
    const stylesDir = resolve(src, "styles");
    const fontsCss = readFileSync(resolve(stylesDir, "fonts.css"), "utf8");
    const urls = [...fontsCss.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(existsSync(resolve(stylesDir, url)), `missing font: ${url}`).toBe(true);
    }
  });
});
