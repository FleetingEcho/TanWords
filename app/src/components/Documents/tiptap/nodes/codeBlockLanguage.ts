/**
 * The stock code block plus a language picker node view.
 *
 * Extends rather than reimplements: input rules (```), paste handling, Tab
 * behaviour and the `language` attr all come from the upstream extension.
 */
import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockView } from "./CodeBlockView";

export const CodeBlockWithLanguage = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
