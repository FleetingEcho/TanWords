import { describe, expect, it } from "vitest";
import { selectRichEditorContents } from "./editorSelection";

describe("selectRichEditorContents", () => {
  it("selects a document that has no trailing empty paragraph", () => {
    const container = document.createElement("div");
    container.innerHTML = '<div class="bn-editor" contenteditable="true"><p>First block</p><p>Last block</p></div>';
    document.body.appendChild(container);

    expect(selectRichEditorContents(container)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("First blockLast block");

    container.remove();
    window.getSelection()?.removeAllRanges();
  });
});
