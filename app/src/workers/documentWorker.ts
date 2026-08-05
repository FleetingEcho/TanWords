/// <reference lib="webworker" />
import { htmlToMarkdown } from "../lib/htmlToMarkdown";
import { blocksToMarkdown, markdownToBlocks } from "../lib/markdown";
import type { Block } from "../components/Documents/tiptap/blocks";

type Request = {
  id: number;
  operation: "markdownToBlocks" | "contentToBlocks" | "blocksToMarkdown" | "blocksToMarkdownWithStats" | "blocksToStorage" | "htmlToMarkdown";
  payload: string | readonly unknown[];
};

function inlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => typeof item === "string" ? item : item?.text ?? inlineText(item?.content)).join("");
  }
  return "";
}

function blocksToText(blocks: readonly unknown[]): string {
  const lines: string[] = [];
  const walk = (items: any[]) => {
    for (const block of items ?? []) {
      const line = block.type === "mermaid" ? inlineText(block.props?.code) : inlineText(block.content);
      if (line) lines.push(line);
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks as any[]);
  return lines.join("\n");
}

async function handle(data: Request) {
  try {
    let result: unknown;
    if (data.operation === "markdownToBlocks") {
      result = markdownToBlocks(data.payload as string);
    } else if (data.operation === "htmlToMarkdown") {
      result = htmlToMarkdown(data.payload as string);
    } else if (data.operation === "contentToBlocks") {
      const content = data.payload as string;
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) result = parsed;
        else throw new Error("legacy-content");
      } catch (error) {
        if (error instanceof Error && error.message === "legacy-content") throw error;
        result = markdownToBlocks(content);
      }
    } else if (data.operation === "blocksToMarkdown") {
      result = blocksToMarkdown(data.payload as readonly Block[]);
    } else if (data.operation === "blocksToMarkdownWithStats") {
      const blocks = data.payload as readonly unknown[];
      const contentText = blocksToText(blocks);
      result = {
        markdown: blocksToMarkdown(blocks as readonly Block[]),
        wordCount: contentText.trim() ? contentText.trim().split(/\s+/).length : 0,
      };
    } else {
      const blocks = data.payload as readonly unknown[];
      const contentText = blocksToText(blocks);
      result = {
        content: JSON.stringify(blocks),
        contentText,
        wordCount: contentText.trim() ? contentText.trim().split(/\s+/).length : 0,
      };
    }
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
}

// Parsing is now pure (remark, no editor state), but the queue stays: callers
// rely on results arriving in the order they were requested — two rapid saves
// finishing out of order would write the older document last.
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<Request>) => {
  queue = queue.then(() => handle(data), () => handle(data));
};

export {};
