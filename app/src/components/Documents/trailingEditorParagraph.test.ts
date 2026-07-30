import {
  withTrailingEditorParagraph,
  withoutTrailingEditorParagraph,
} from "./trailingEditorParagraph";

it("adds exactly one empty paragraph after document content", () => {
  const content = [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }];
  const withTrailing = withTrailingEditorParagraph(content);

  expect(withTrailing).toHaveLength(2);
  expect(withTrailing[withTrailing.length - 1]).toEqual({ type: "paragraph" });
  expect(withTrailingEditorParagraph(withTrailing)).toHaveLength(2);
});

it("removes the editing-only paragraph before serialization", () => {
  const blocks = [
    { type: "heading", content: [{ type: "text", text: "Title" }] },
    { type: "paragraph" },
  ];

  expect(withoutTrailingEditorParagraph(blocks)).toEqual([blocks[0]]);
});
