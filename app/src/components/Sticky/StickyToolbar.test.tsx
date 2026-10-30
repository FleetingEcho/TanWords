import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { buildExtensions } from "../Documents/tiptap/schema";
import { StickyToolbar } from "./StickyToolbar";
import { insertRenderedMarkdown } from "./insertRenderedMarkdown";

function makeEditor(json: object, holder: HTMLElement) {
  const editor = new Editor({ extensions: buildExtensions(), content: json });
  document.body.appendChild(holder);
  editor.mount(holder);
  return editor;
}

describe("StickyToolbar portal palette flow", () => {
  afterEach(cleanup);

  it("highlight/text-color palettes open OUTSIDE the clipped strip and apply marks", () => {
    const holder = document.createElement("div");
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }] }, holder);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.focus();
    });
    const utils = render(<StickyToolbar editor={editor} />);

    fireEvent.click(utils.getByTitle("Highlight"));
    const swatch = utils.getByTitle("yellow");
    // Portaled: not clipped inside the scrolling strip.
    expect(swatch.closest("div.rounded-lg")?.parentElement).toBe(document.body);
    fireEvent.click(swatch);

    fireEvent.click(utils.getByTitle("Text color"));
    fireEvent.click(utils.getByTitle("red"));

    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"highlight"');
    expect(json).toContain('"textStyle"');
    editor.destroy();
    holder.remove();
  });

  it("code-block paint buttons appear only in code and set node attrs; round trip via blocks", async () => {
    const holder = document.createElement("div");
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "let x = 1;" }] },
      ],
    }, holder);
    const utils = render(<StickyToolbar editor={editor} />);

    // Caret in the paragraph → no code paint controls.
    act(() => { editor.commands.setTextSelection({ from: 2, to: 4 }); editor.commands.focus(); });
    expect(utils.queryByTitle("Code background")).toBeNull();

    // Move into the code block: paragraph(0..8 incl boundaries) then codeBlock starts at 9 → content from 10.
    act(() => { editor.commands.setTextSelection({ from: 11, to: 13 }); editor.commands.focus(); });
    const cbBg = utils.getByTitle("Code background");
    fireEvent.click(cbBg);
    fireEvent.click(utils.getByTitle("dark"));
    const cbText = utils.getByTitle("Code text colour");
    fireEvent.click(cbText);
    fireEvent.click(utils.getByTitle("paper"));

    const cb = editor.getJSON().content!.find((n) => n.type === "codeBlock")!;
    expect(cb.attrs?.backgroundColor).toBe("#1f2937");
    expect(cb.attrs?.textColor).toBe("#f9fafb");

    // Storage round-trip: pm → blocks → pm keeps the attrs (attrsToProps/propsToAttrs passthrough).
    const { pmDocToBlocks, blocksToPmDoc } = await import("../Documents/tiptap/blockAdapter");
    const blocks = pmDocToBlocks(editor.getJSON() as never);
    const codeBlock = blocks.find((b: {type: string}) => b.type === "codeBlock")!;
    expect(codeBlock.props?.backgroundColor).toBe("#1f2937");
    expect(codeBlock.props?.textColor).toBe("#f9fafb");
    const back = blocksToPmDoc(blocks);
    const cb2 = (back.content as never[]).find((n) => (n as {type:string}).type === "codeBlock") as unknown as { attrs?: Record<string, unknown> };
    expect(cb2.attrs?.backgroundColor).toBe("#1f2937");

    editor.destroy();
    holder.remove();
  });

  it("renders pasted Markdown in the live Tiptap editor", async () => {
    const holder = document.createElement("div");
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph" }] }, holder);
    const utils = render(
      <StickyToolbar editor={editor} onPasteMarkdown={(markdown) => insertRenderedMarkdown(editor, markdown)} />,
    );

    fireEvent.click(utils.getByTitle("Paste Markdown as formatted note"));
    fireEvent.change(utils.getByPlaceholderText("Paste Markdown here…"), {
      target: { value: "## Plan\n\n- first\n- second" },
    });
    fireEvent.click(utils.getByText("Insert formatted"));

    await waitFor(() => {
      expect(holder.querySelector("h2")?.textContent).toBe("Plan");
      expect(holder.querySelectorAll("ul li")).toHaveLength(2);
    });
    editor.destroy();
    holder.remove();
  });
});
