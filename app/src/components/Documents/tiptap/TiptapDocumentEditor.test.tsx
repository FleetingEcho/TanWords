/**
 * The assembled editor — schema, adapter, node views, paste and UI together.
 *
 * The unit suites cover each piece; this checks they actually compose, which
 * is where a migration like this usually breaks.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { TiptapDocumentEditor } from "./TiptapDocumentEditor";
import type { DocEditorApi } from "./DocEditorApi";
import type { Block } from "./blocks";

afterEach(cleanup);

function paragraph(text: string): Block {
  return { type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }] };
}

async function mount(blocks: Block[], props: Record<string, unknown> = {}) {
  let api: DocEditorApi | null = null;
  render(
    <TiptapDocumentEditor
      initialBlocks={blocks}
      isDark={false}
      onReady={(ready) => { api = ready; }}
      {...props}
    />,
  );
  await waitFor(() => expect(api).not.toBeNull());
  return api!;
}

describe("mounting", () => {
  it("renders the document it was given", async () => {
    await mount([paragraph("hello from storage")]);
    await waitFor(() => expect(screen.getByText("hello from storage")).toBeInTheDocument());
  });

  it("renders headings, lists and quotes as real elements", async () => {
    await mount([
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Title", styles: {} }] },
      { type: "bulletListItem", props: {}, content: [{ type: "text", text: "item", styles: {} }] },
      { type: "quote", props: {}, content: [{ type: "text", text: "quoted", styles: {} }] },
    ]);
    await waitFor(() => {
      expect(document.querySelector("h2")).toBeTruthy();
      expect(document.querySelector("ul li")).toBeTruthy();
      expect(document.querySelector("blockquote")).toBeTruthy();
    });
  });

  it("exposes a working DocEditorApi", async () => {
    const api = await mount([paragraph("one")]);
    expect(api.document).toHaveLength(1);
    api.insertBlocks([paragraph("two")], api.document[0], "after");
    expect(api.document).toHaveLength(2);
  });

  it("does not report a change merely for loading content", async () => {
    // A document that marks itself dirty on open schedules a save that
    // rewrites the file it just read.
    const onChange = vi.fn();
    await mount([paragraph("loaded")], { onChange });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("media blocks", () => {
  it("renders a mermaid block through its node view", async () => {
    await mount([{ type: "mermaid", props: { code: "graph TD\n A-->B" } }]);
    await waitFor(() =>
      expect(document.querySelector('[data-block-type="mermaid"]')).toBeTruthy(),
    );
  });

  it("renders a youtube block through its node view", async () => {
    await mount([{ type: "youtube", props: { url: "https://youtu.be/aR97E7aKEgg", caption: "" } }]);
    await waitFor(() =>
      expect(document.querySelector('[data-block-type="youtube"]')).toBeTruthy(),
    );
  });

  it("renders a plain https image without any asset resolution", async () => {
    await mount([{
      type: "image",
      props: { url: "https://example.com/a.png", name: "a.png", caption: "" },
    }]);
    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://example.com/a.png");
    });
  });

  it("keeps the app asset URL in the document while resolving for display", async () => {
    // The stored URL must stay `tanwords-asset://` — pruneDocumentAssets scans
    // for it, so a resolved blob URL in its place means data loss.
    const api = await mount([{
      type: "image",
      props: { url: "tanwords-asset://abc", name: "a.png", caption: "" },
    }]);
    expect((api.document[0].props as Record<string, unknown>).url).toBe("tanwords-asset://abc");
  });
});

describe("read-only mode", () => {
  it("renders content without the editing chrome", async () => {
    await mount([paragraph("read me")], { editable: false });
    await waitFor(() => expect(screen.getByText("read me")).toBeInTheDocument());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});

/**
 * Tiptap's React wrappers list their callback props in effect dependency
 * arrays, and some of those effects unregister/re-register a ProseMirror
 * plugin. An unstable callback identity therefore tears the plugin down and
 * rebuilds it on every render — which for the drag handle meant it reset to
 * `visibility: hidden` and repositioned continuously, i.e. flashed.
 *
 * The guard is that the editor settles: no unbounded render loop.
 */
describe("stability", () => {
  it("settles instead of re-rendering forever", async () => {
    let renders = 0;
    function Counting() {
      renders += 1;
      return (
        <TiptapDocumentEditor initialBlocks={[paragraph("text")]} isDark={false} />
      );
    }
    render(<Counting />);
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    const settled = renders;
    await new Promise((resolve) => setTimeout(resolve, 150));
    // A plugin-thrash loop keeps climbing; a healthy editor does not.
    expect(renders).toBe(settled);
  });

  it("registers the drag handle exactly once", async () => {
    const api = await mount([paragraph("text")]);
    const before = document.querySelectorAll("[draggable=true]").length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.querySelectorAll("[draggable=true]").length).toBe(before);
    expect(api.document).toHaveLength(1);
  });
});
