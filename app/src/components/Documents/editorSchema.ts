/**
 * Editor schema with shiki syntax highlighting for code blocks.
 * Import ONLY from lazily-loaded editor components (DocEditor,
 * LocalDocEditor) — @blocknote/code-block bundles shiki and must stay out
 * of the main chunk.
 */
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { MermaidBlock } from "./MermaidBlock";

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    mermaid: MermaidBlock(),
  },
});
