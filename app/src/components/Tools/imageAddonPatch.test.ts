import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const addonRoot = resolve(process.cwd(), "node_modules/@xterm/addon-image");

describe("@xterm/addon-image HiDPI patch", () => {
  it("uses logical cells for layout and device pixels only for canvas resolution", () => {
    const rendererSource = readFileSync(resolve(addonRoot, "src/ImageRenderer.ts"), "utf8");
    const runtimeSource = readFileSync(resolve(addonRoot, "lib/addon-image.mjs"), "utf8");

    expect(rendererSource).toContain("width: this.dimensions?.css.cell.width");
    expect(rendererSource).toContain("height: this.dimensions?.css.cell.height");
    expect(rendererSource).toContain("const backingWidth = this.dimensions?.device.canvas.width");
    expect(rendererSource).toContain("this._ctx?.setTransform(scaleX, 0, 0, scaleY, 0, 0)");

    // Vite consumes the package's compiled ESM entry, so guard the generated
    // runtime as well as the TypeScript source stored in the Bun patch.
    expect(runtimeSource).toContain("this.dimensions?.css.cell.width");
    expect(runtimeSource).toContain("this.dimensions?.device.canvas.width");
    expect(runtimeSource).toContain("this._ctx?.setTransform(");
  });
});
