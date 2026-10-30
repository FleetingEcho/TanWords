import { afterEach, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../schema";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

it("turns a fenced language line into a code block on Enter", () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: buildExtensions(), content: "<p>```tsx</p>" });
  editor.commands.setTextSelection(7);

  fireEvent.keyDown(editor.view.dom, { key: "Enter", code: "Enter" });

  expect(editor.getJSON().content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "tsx" } });
});

it("turns a fenced language line into code inside a numbered list", () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: buildExtensions(), content: "<ol><li><p>```tsx</p></li></ol>" });
  editor.commands.focus("end");

  fireEvent.keyDown(editor.view.dom, { key: "Enter", code: "Enter" });

  expect(editor.getJSON().content?.find((node) => node.type === "codeBlock"))
    .toMatchObject({ type: "codeBlock", attrs: { language: "tsx" } });
});
