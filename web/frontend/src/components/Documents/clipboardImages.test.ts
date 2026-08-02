import { describe, expect, it } from "vitest";
import { clipboardImageFiles, clipboardImageFilesOrNative } from "./clipboardImages";

describe("clipboardImageFiles", () => {
  it("uses image files when the clipboard exposes the standard files list", () => {
    const image = new File(["pixels"], "clipboard.png", { type: "image/png" });
    const data = {
      files: [image] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    };

    expect(clipboardImageFiles(data)).toEqual([image]);
  });

  it("finds an image exposed through clipboard items when files is empty", () => {
    const image = new File(["pixels"], "clipboard.png", { type: "image/png" });
    const data = {
      files: [] as unknown as FileList,
      items: [{
        kind: "file",
        type: "image/png",
        getAsFile: () => image,
      }] as unknown as DataTransferItemList,
    };

    expect(clipboardImageFiles(data)).toEqual([image]);
  });

  it("falls back to the native clipboard when the WebView exposes no image files", async () => {
    const image = new File(["pixels"], "clipboard.png", { type: "image/png" });
    const data = {
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    };

    expect(await clipboardImageFilesOrNative(data, async () => image)).toEqual([image]);
  });
});
