/**
 * Markdown ⇄ blocks, with no editor involved.
 *
 * The replacement for BlockNote's `tryParseMarkdownToBlocks` /
 * `blocksToMarkdownLossy`. Being a pure remark pipeline, this works in the
 * document worker with no DOM — which is what let the worker stop booting a
 * ~1.4MB headless editor just to parse text.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import type { Block } from "@/components/Documents/tiptap/blocks";
import { mdastToBlocks } from "./mdastToBlocks";
import { blocksToMdast } from "./blocksToMdast";
import { repairMarkdown } from "../markdownPreparse";

const parser = unified().use(remarkParse).use(remarkGfm);

const serializer = unified()
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fence: "`",
    fences: true,
    listItemIndent: "one",
    rule: "-",
    // Off: remark escapes `_` and `*` inside words by default, which turns a
    // filename like `my_file.md` into `my\_file.md` on every save.
    handlers: undefined,
  });

/** Markdown → blocks. Input is repaired first (see `markdownPreparse`). */
export function markdownToBlocks(markdown: string): Block[] {
  return mdastToBlocks(parser.parse(repairMarkdown(markdown)) as never);
}

/** Blocks → markdown. Lossy by design — see `blocksToMdast`. */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  return serializer.stringify(blocksToMdast(blocks) as never).trimEnd();
}
