/** Runs the transforms against BlockNote's *real* markdown parser.
 *
 *  The hand-written tests next door assert on block shapes I wrote myself, so
 *  they kept passing while the feature was broken in the app: BlockNote parses
 *  a bare URL as plain text (not a link) and `![](…)` as an image block, and
 *  the lift only handled link nodes. Anything that claims "markdown X becomes
 *  block Y" belongs here instead. */
import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { liftMedia, liftYouTube, lowerMedia, lowerYouTube } from "./mediaTransforms";
import { repairMarkdown } from "@/lib/markdownPreparse";

const VIDEO = "https://youtu.be/aR97E7aKEgg?si=q3_UL6G7f7oMpE-e";
/** The shape you get from the browser's address bar, which is what anyone
 *  actually pastes. Every case below runs against both — the suite used to
 *  test only the share-sheet form. */
const WATCH = "https://www.youtube.com/watch?v=iQyg-KypKAA";

async function parse(markdown: string) {
  const editor = BlockNoteEditor.create();
  return editor.tryParseMarkdownToBlocks(repairMarkdown(markdown));
}

describe("YouTube links written in markdown", () => {
  it.each([
    ["a titled link", `[123](${VIDEO})`, "aR97E7aKEgg"],
    ["a bare url", VIDEO, "aR97E7aKEgg"],
    ["image syntax", `![123](${VIDEO})`, "aR97E7aKEgg"],
    ["a titled watch link", `[123](${WATCH})`, "iQyg-KypKAA"],
    ["a bare watch url", WATCH, "iQyg-KypKAA"],
    ["watch image syntax", `![123](${WATCH})`, "iQyg-KypKAA"],
    // BlockNote drops a link with no label entirely, URL and all, so this only
    // survives because the markdown is repaired before it is parsed.
    ["an empty-label link", `[](${WATCH})`, "iQyg-KypKAA"],
  ])("turns %s into a player", async (_label, markdown, id) => {
    const lifted = liftYouTube(await parse(markdown));
    expect(lifted).toHaveLength(1);
    expect(lifted[0].type).toBe("youtube");
    expect(lifted[0].props.url).toContain(id);
  });

  it("rescues a built-in media block pointed at YouTube", () => {
    // Reaching for the video block is the natural move, and <video src> can
    // only ever show controls stuck at 0:00 for a watch page.
    for (const type of ["video", "image", "audio", "file"]) {
      const lifted = liftYouTube([{ type, props: { url: VIDEO } }]);
      expect(lifted[0].type).toBe("youtube");
    }
  });

  it("survives the full rich -> raw -> rich trip switchMode performs", async () => {
    const editor = BlockNoteEditor.create();
    const start: any[] = [{ type: "video", props: { url: VIDEO, name: "" } }];
    const markdown = await editor.blocksToMarkdownLossy(lowerYouTube(lowerMedia(start)) as any);
    const parsed = await editor.tryParseMarkdownToBlocks(markdown);
    expect(liftYouTube(liftMedia(parsed))[0].type).toBe("youtube");
  });

  it("keeps the author's title through a full raw -> rich -> raw trip", async () => {
    const editor = BlockNoteEditor.create();
    const lifted = liftYouTube(await parse(`[tttt](${WATCH})`));
    expect(lifted[0].props.caption).toBe("tttt");

    const markdown = await editor.blocksToMarkdownLossy(lowerYouTube(lifted) as any);
    expect(markdown).toContain("[tttt]");

    const again = liftYouTube(await parse(markdown));
    expect(again[0].type).toBe("youtube");
    expect(again[0].props.caption).toBe("tttt");
    expect(again[0].props.url).toContain("iQyg-KypKAA");
  });

  it("does not invent a title for an untitled player", async () => {
    const editor = BlockNoteEditor.create();
    const lifted = liftYouTube(await parse(WATCH));
    expect(lifted[0].props.caption).toBe("");
    // Lowering writes the URL as its own label, which must read back as
    // "no caption" rather than as a title that happens to be a URL.
    const markdown = await editor.blocksToMarkdownLossy(lowerYouTube(lifted) as any);
    expect(liftYouTube(await parse(markdown))[0].props.caption).toBe("");
  });

  it("leaves a link inside a sentence as prose", async () => {
    const lifted = liftYouTube(await parse(`see [this](${VIDEO}) later`));
    expect(lifted[0].type).toBe("paragraph");
  });

  it("leaves non-YouTube links and real images alone", async () => {
    const link = liftYouTube(await parse("[docs](https://example.com)"));
    expect(link[0].type).toBe("paragraph");
    const image = liftYouTube(await parse("![shot](https://example.com/a.png)"));
    expect(image[0].type).toBe("image");
  });
});
