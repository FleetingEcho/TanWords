import type { Editor } from "@tiptap/core";
import { markdownToBlocksOffThread } from "@/lib/documentWorkerClient";
import { blocksToPmDoc } from "@/components/Documents/tiptap/blockAdapter";
import { liftMermaid } from "@/components/Documents/mermaidTransforms";
import { liftMedia, liftYouTube } from "@/components/Documents/mediaTransforms";

/** Explicit Markdown paste for stickies. Ordinary paste stays literal; this
 *  action uses the same parser and media conversions as the document editor. */
export async function insertRenderedMarkdown(editor: Editor, markdown: string): Promise<boolean> {
  if (!markdown.trim() || editor.isDestroyed) return false;
  const parsed = await markdownToBlocksOffThread(markdown);
  if (editor.isDestroyed || parsed.length === 0) return false;
  const blocks = liftYouTube(liftMedia(liftMermaid(parsed)));
  const content = blocksToPmDoc(blocks).content ?? [];
  return editor.chain().focus().insertContent(content).run();
}
