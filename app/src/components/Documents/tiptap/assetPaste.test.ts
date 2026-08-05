/**
 * The paste → upload → render chain (plan.md §4c).
 *
 * `DocEditor` had no paste handler of its own and relied entirely on
 * BlockNote's internal pipeline, so this is the behaviour most likely to
 * disappear silently in the migration. Tested against a real Tiptap editor
 * rather than a mock, because the failure mode is "nothing happens".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { Editor } from "@tiptap/core";
import { buildExtensions } from "./schema";
import { insertUploadedFile, blockTypeForFile } from "./assetPaste";
import { pmDocToBlocks } from "./blockAdapter";

function imageFile(name = "shot.png", bytes = 128) {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

function makeEditor(upload: (file: File) => Promise<string>) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: buildExtensions({ upload }), content: "<p></p>" });
}

let editor: Editor | null = null;

beforeEach(() => { editor = null; });
afterEach(() => { editor?.destroy(); document.body.innerHTML = ""; });

/** The blocks as they would be serialized to storage right now. */
function storedBlocks(current: Editor) {
  return pmDocToBlocks(current.getJSON() as never);
}

describe("pasting an image", () => {
  it("stores it and renders it from the returned asset URL", async () => {
    editor = makeEditor(async () => "tanwords-asset://abc-123");
    await insertUploadedFile(editor, imageFile(), {
      upload: async () => "tanwords-asset://abc-123",
      onError: null,
      onChanged: null,
    });

    const image = storedBlocks(editor).find((block) => block.type === "image");
    expect(image).toBeDefined();
    expect((image!.props as Record<string, unknown>).url).toBe("tanwords-asset://abc-123");
    expect((image!.props as Record<string, unknown>).name).toBe("shot.png");
  });

  it("shows the block immediately, before the upload resolves", async () => {
    let release: (url: string) => void = () => {};
    const pending = new Promise<string>((resolve) => { release = resolve; });
    editor = makeEditor(() => pending);

    const done = insertUploadedFile(editor, imageFile(), {
      upload: () => pending,
      onError: null,
      onChanged: null,
    });

    // A large file routed to R2 takes seconds; the block must already be there.
    const placeholder = storedBlocks(editor).find((block) => block.type === "image");
    expect(placeholder).toBeDefined();
    expect((placeholder!.props as Record<string, unknown>).url).toBe("");

    release("tanwords-asset://late");
    await done;
    const settled = storedBlocks(editor).find((block) => block.type === "image");
    expect((settled!.props as Record<string, unknown>).url).toBe("tanwords-asset://late");
  });

  it("never lets the transient uploadId reach storage", async () => {
    // An autosave firing mid-upload must not write editor bookkeeping into
    // the stored document.
    let release: (url: string) => void = () => {};
    const pending = new Promise<string>((resolve) => { release = resolve; });
    editor = makeEditor(() => pending);
    const done = insertUploadedFile(editor, imageFile(), { upload: () => pending, onError: null, onChanged: null });

    expect(JSON.stringify(storedBlocks(editor))).not.toContain("uploadId");
    expect(JSON.stringify(storedBlocks(editor))).not.toContain("blob:");

    release("tanwords-asset://x");
    await done;
    expect(JSON.stringify(storedBlocks(editor))).not.toContain("uploadId");
  });

  it("removes the placeholder and reports when the upload fails", async () => {
    const onError = vi.fn();
    editor = makeEditor(async () => { throw new Error("network down"); });
    await insertUploadedFile(editor, imageFile(), {
      upload: async () => { throw new Error("network down"); },
      onError,
      onChanged: null,
    });

    // A permanent spinner the user cannot delete is worse than no image.
    expect(storedBlocks(editor).some((block) => block.type === "image")).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });

  it("arms the caller's autosave", async () => {
    const onChanged = vi.fn();
    editor = makeEditor(async () => "tanwords-asset://a");
    await insertUploadedFile(editor, imageFile(), {
      upload: async () => "tanwords-asset://a",
      onError: null,
      onChanged,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("survives the user typing while the upload is in flight", async () => {
    // Positions drift during an async upload, so the node is found by its
    // uploadId rather than a remembered position.
    let release: (url: string) => void = () => {};
    const pending = new Promise<string>((resolve) => { release = resolve; });
    editor = makeEditor(() => pending);
    const done = insertUploadedFile(editor, imageFile(), { upload: () => pending, onError: null, onChanged: null });

    editor.commands.setTextSelection(0);
    editor.commands.insertContent("text typed before the image ");

    release("tanwords-asset://moved");
    await done;
    const image = storedBlocks(editor).find((block) => block.type === "image");
    expect((image!.props as Record<string, unknown>).url).toBe("tanwords-asset://moved");
  });
});

describe("attachment typing", () => {
  it.each([
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"],
    ["application/pdf", "file"],
  ])("routes %s to a %s block", (mime, expected) => {
    expect(blockTypeForFile(new File([""], "f", { type: mime }))).toBe(expected);
  });

  it("keeps whatever URL the upload returned, DB or R2 alike", async () => {
    // Routing is decided in documentAssets.uploadDocumentAsset; this layer
    // must be indifferent to which path ran.
    for (const url of ["tanwords-asset://db-row", "tanwords-asset://r2-routed"]) {
      const current = makeEditor(async () => url);
      await insertUploadedFile(current, imageFile("big.mp4"), {
        upload: async () => url,
        onError: null,
        onChanged: null,
      });
      const block = storedBlocks(current).find((b) => b.type === "image");
      expect((block!.props as Record<string, unknown>).url).toBe(url);
      current.destroy();
    }
  });
});
