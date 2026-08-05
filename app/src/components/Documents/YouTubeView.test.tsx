import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

import { render } from "@testing-library/react";
import { TiptapDocumentEditor } from "./tiptap/TiptapDocumentEditor";

const WATCH = "https://www.youtube.com/watch?v=iQyg-KypKAA";

function Harness({ caption = "" }: { caption?: string }) {
  return (
    <TiptapDocumentEditor
      initialBlocks={[{ type: "youtube", props: { url: WATCH, caption } }]}
      isDark={false}
    />
  );
}

/** jsdom does no layout, so these assert the two *attributes* that carry the
 *  layout — both of which have already been shipped missing once:
 *
 *  - without `contentEditable={false}`, ProseMirror reconciles the iframe out
 *    of its contenteditable and the block renders empty;
 *  - without an explicit width, the block is a shrink-to-fit flex item inside
 *    BlockNote's `display: flex` .bn-block-content and an iframe adds no
 *    intrinsic width, so the player ends up exactly as wide as its caption.
 *
 *  Neither shows up in a render test that only looks for the iframe. */
describe("the YouTube player block", () => {
  it("renders a player for the video", () => {
    const { container } = render(<Harness />);
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toContain("iQyg-KypKAA");
  });

  it("opts its own DOM out of ProseMirror's contenteditable", () => {
    const { container } = render(<Harness />);
    const root = container.querySelector("iframe")!.closest("[contenteditable='false']");
    expect(root).not.toBeNull();
  });

  it("takes a width of its own instead of its caption's", () => {
    const { container } = render(<Harness caption="t" />);
    const root = container.querySelector("iframe")!.closest("div.w-full");
    expect(root).not.toBeNull();
  });

  it("shows the caption, and shows nothing when there is none", () => {
    const withCaption = render(<Harness caption="a title" />);
    expect(withCaption.container.textContent).toContain("a title");

    const without = render(<Harness />);
    expect(without.container.querySelector("iframe")).not.toBeNull();
  });
});
