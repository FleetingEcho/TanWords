import { describe, it, expect } from "vitest";
import { liftMedia, lowerMedia } from "./mediaTransforms";

/** Markdown has no video syntax, so a raw-mode round trip used to turn an mp4
 *  block into an image block — which renders as a broken-image icon. */
describe("media round trip through markdown", () => {
  it("restores a video block after the type is carried through the URL", () => {
    const original = [
      { type: "video", props: { url: "tanwords-asset://abc", name: "clip.mp4" } },
    ];
    const lowered = lowerMedia(original);
    expect(lowered[0].props.url).toBe("tanwords-asset://abc?tanwords-type=video");

    // What markdown parsing gives back: everything becomes an image.
    const asImage = [{ type: "image", props: lowered[0].props }];
    expect(liftMedia(asImage as any)).toEqual([
      { type: "video", props: { url: "tanwords-asset://abc", name: "clip.mp4" } },
    ]);
  });

  it("keeps audio and file blocks distinct", () => {
    for (const type of ["audio", "file"] as const) {
      const lowered = lowerMedia([{ type, props: { url: "tanwords-asset://x" } }]);
      const lifted = liftMedia([{ type: "image", props: lowered[0].props }] as any);
      expect(lifted[0].type).toBe(type);
      expect(lifted[0].props.url).toBe("tanwords-asset://x");
    }
  });

  it("leaves real images and external URLs alone", () => {
    const blocks = [
      { type: "image", props: { url: "tanwords-asset://img" } },
      { type: "image", props: { url: "https://example.com/a.png" } },
    ];
    expect(lowerMedia(blocks)).toEqual(blocks);
    expect(liftMedia(blocks as any)).toEqual(blocks);
  });

  it("recurses into nested blocks", () => {
    const nested = [{ type: "paragraph", children: [{ type: "video", props: { url: "tanwords-asset://n" } }] }];
    const lowered = lowerMedia(nested);
    expect(lowered[0].children[0].props.url).toContain("tanwords-type=video");
  });
});
