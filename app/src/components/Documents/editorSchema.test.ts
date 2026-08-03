import { describe, it, expect, vi } from "vitest";

// The schema pulls in React blocks -> useT -> settingsStore, which touches
// matchMedia at import time.
// hoisted: the schema's React blocks touch matchMedia at *import* time.
vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});
import { BlockNoteEditor } from "@blocknote/core";
import { editorSchema } from "./editorSchema";

/** The block only exists if the schema registers it — and the editor captures
 *  the schema when it is created, so a schema change needs a full reload, not
 *  a hot update. This pins the registration itself. */
describe("editor schema", () => {
  it("accepts a youtube block", () => {
    const editor = BlockNoteEditor.create({ schema: editorSchema });
    editor.replaceBlocks(editor.document, [
      { type: "youtube", props: { url: "https://youtu.be/aR97E7aKEgg" } } as any,
    ]);
    expect(editor.document[0].type).toBe("youtube");
  });
});
