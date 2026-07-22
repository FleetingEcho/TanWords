/// <reference lib="webworker" />
import { BlockNoteEditor } from "@blocknote/core";

type Request = {
  id: number;
  operation: "markdownToBlocks" | "contentToBlocks" | "blocksToMarkdown" | "blocksToStorage";
  payload: string | readonly unknown[];
};

let parser: BlockNoteEditor | null = null;
const getParser = () => (parser ??= BlockNoteEditor.create());

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
      result = await getParser().tryParseMarkdownToBlocks(data.payload as string);
    } else if (data.operation === "contentToBlocks") {
      const content = data.payload as string;
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) result = parsed;
        else throw new Error("legacy-content");
      } catch (error) {
        if (error instanceof Error && error.message === "legacy-content") throw error;
        result = await getParser().tryParseMarkdownToBlocks(content);
      }
    } else if (data.operation === "blocksToMarkdown") {
      result = await getParser().blocksToMarkdownLossy(data.payload as any);
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

// A single headless editor backs parsing and serialization. Queue work so two
// rapid saves cannot mutate/use that editor concurrently or finish out of order.
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<Request>) => {
  queue = queue.then(() => handle(data), () => handle(data));
};

export {};
