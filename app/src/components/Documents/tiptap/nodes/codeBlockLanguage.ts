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
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if (!selection.empty || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return false;
        const match = /^```([\w+-]+)?$/.exec($from.parent.textContent);
        if (!match || !$from.node($from.depth - 1)?.type.name.endsWith("listItem")) return false;
        return this.editor.chain()
          .deleteRange({ from: $from.start(), to: $from.end() })
          .liftListItem($from.node($from.depth - 1).type.name)
          // setCodeBlock's typing wants a string; passing undefined keeps
          // the extension's default (null = plain).
          .setCodeBlock(match[1] ? { language: match[1] } : undefined)
          .run();
      },
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      // User-tintable paint (2026-10): marks are disabled inside code blocks
      // (Shiki owns per-token colours), so these BLOCK-LEVEL attrs are the
      // sticky toolbar's way to recolour a block. `null` = "default" so
      // attrsToProps drops unset blocks instead of writing attr noise into
      // every save; the adapter round-trips unset attrs as absent both ways.
      backgroundColor: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-background-color"),
      },
      textColor: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-text-color"),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    // The stock shape — `<pre><code class="language-x">` — plus
    // `data-language` on BOTH elements: `documentExport` finds mermaid
    // fences by `pre[data-language="mermaid"]` and code blocks to highlight
    // by `pre > code[data-language]`. That was the old editor's serialized
    // shape; without it both export steps silently match nothing. The class
    // stays, so paste/import still parses. Only serialization is affected —
    // the live editor renders through the node view below, not this.
    // Custom tints fold into the serialized <pre>'s inline style so exported
    // HTML keeps the user's colours even outside the app.
    const tinted: Record<string, string> = {};
    const style: string[] = [];
    if (node.attrs.backgroundColor) {
      tinted["data-background-color"] = node.attrs.backgroundColor;
      style.push(`background-color: ${node.attrs.backgroundColor}`);
    }
    if (node.attrs.textColor) {
      tinted["data-text-color"] = node.attrs.textColor;
      tinted["data-toned"] = "true";
      style.push(`color: ${node.attrs.textColor}`);
    }
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-language": node.attrs.language || null,
        ...tinted,
        ...(style.length ? { style: style.join("; ") } : {}),
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
