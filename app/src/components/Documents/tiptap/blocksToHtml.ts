/**
 * Blocks → HTML, without a mounted editor.
 *
 * Replaces `BlockNoteEditor.blocksToHTMLLossy` for the export paths that
 * serialize stored content rather than a live document (`exportMarkdownAsHtml`,
 * `exportMarkdownAsPdf`). Needs a DOM for `DOMSerializer`, so it runs on the
 * renderer — the same constraint the BlockNote version had.
 *
 * The output shape matters: `documentExport` post-processes it, finding mermaid
 * diagrams by `pre.mermaid` and code blocks by `pre > code[data-language]`.
 */
import { getSchema } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { buildExtensions } from "./schema";
import { blocksToPmDoc } from "./blockAdapter";
import type { Block } from "./blocks";

let cachedSchema: ReturnType<typeof getSchema> | null = null;

/** Built once — the schema is derived purely from the extension list. */
function schema() {
  return (cachedSchema ??= getSchema(buildExtensions()));
}

export function blocksToHtml(blocks: readonly Block[]): string {
  const node = schema().nodeFromJSON(blocksToPmDoc(blocks));
  const fragment = DOMSerializer.fromSchema(schema()).serializeFragment(node.content);
  const holder = document.createElement("div");
  holder.appendChild(fragment);
  return holder.innerHTML;
}
