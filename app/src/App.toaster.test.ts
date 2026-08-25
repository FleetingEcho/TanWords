import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

describe("web notification placement", () => {
  it("uses one host-aware position in every App state", () => {
    expect(appSource).toContain(
      'const APP_TOAST_POSITION = isWebHost ? "top-center" : "bottom-right";',
    );
    expect(appSource.match(/<Toaster position=\{APP_TOAST_POSITION\}/g)).toHaveLength(1);
    expect(appSource.match(/<AppToaster \/>/g)).toHaveLength(6);
    expect(appSource).not.toContain('<Toaster position="bottom-right"');
  });
});
