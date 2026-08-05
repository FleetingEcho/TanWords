/**
 * The stock code block plus a language picker node view.
 *
 * Extends rather than reimplements: input rules (```), paste handling, Tab
 * behaviour and the `language` attr all come from the upstream extension.
 */
import CodeBlock from "@tiptap/extension-code-block";
import { mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockView } from "./CodeBlockView";

export const CodeBlockWithLanguage = CodeBlock.extend({
  renderHTML({ node, HTMLAttributes }) {
    // The stock shape — `<pre><code class="language-x">` — plus
    // `data-language` on BOTH elements: `documentExport` finds mermaid
    // fences by `pre[data-language="mermaid"]` and code blocks to highlight
    // by `pre > code[data-language]`. That was the old editor's serialized
    // shape; without it both export steps silently match nothing. The class
    // stays, so paste/import still parses. Only serialization is affected —
    // the live editor renders through the node view below, not this.
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-language": node.attrs.language || null,
      }),
      [
        "code",
        {
          class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null,
          "data-language": node.attrs.language || null,
        },
        0,
      ],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
