import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const addonRoot = resolve(process.cwd(), "node_modules/@xterm/addon-image");

describe("@xterm/addon-image HiDPI patch", () => {
  it("uses logical cells for layout and device pixels only for canvas resolution", () => {
    const rendererSource = readFileSync(resolve(addonRoot, "src/ImageRenderer.ts"), "utf8");
    const runtimeSource = readFileSync(resolve(addonRoot, "lib/addon-image-hidpi.mjs"), "utf8");
    const packageJson = JSON.parse(readFileSync(resolve(addonRoot, "package.json"), "utf8"));

    expect(rendererSource).toContain("width: this.dimensions?.css.cell.width");
    expect(rendererSource).toContain("height: this.dimensions?.css.cell.height");

    // Vite consumes this wrapper through the package's ESM entry. The wrapper
    // leaves upstream protocol geometry untouched and only increases the
    // canvas backing resolution before scaling back to logical CSS pixels.
    expect(packageJson.module).toBe("lib/addon-image-hidpi.mjs");
    expect(runtimeSource).toContain("from './addon-image.mjs'");
    expect(runtimeSource).toContain("renderer.dimensions?.css.canvas.width");
    expect(runtimeSource).toContain("renderer.dimensions?.device.canvas.width");
    expect(runtimeSource).toContain("canvas.style.width = `${cssWidth}px`");
    expect(runtimeSource).toContain("renderer._ctx?.setTransform(");
    expect(runtimeSource).toContain("renderer.insertLayerToDom = () =>");
    expect(runtimeSource).toContain("renderer.rescaleCanvas = () => syncCanvasResolution(renderer)");
  });
});
