import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** electron-builder compares electronLanguages against the complete locale
 * filename. Values such as `en` and `zh_CN` therefore delete every `.pak`
 * from the packaged app, after which Chromium's Windows renderer crashes at
 * startup and leaves only BrowserWindow.backgroundColor visible. */
describe("packaged Electron locales", () => {
  it("keeps the English and Simplified Chinese Chromium locale packs", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "electron-builder.yml"), "utf8");
    const block = config.match(/^electronLanguages:\s*\r?\n((?:^(?:  .*)?\r?\n)+)/m)?.[1] ?? "";
    const languages = [...block.matchAll(/^  -\s+([^\s#]+)\s*$/gm)].map((match) => match[1]);

    expect(languages).toEqual(["en-US", "zh-CN"]);
  });
});
