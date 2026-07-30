function isLocalAssetPath(url: string): boolean {
  return /(?:^|\/)assets\/[^/]+$/i.test(url.split(/[?#]/, 1)[0]);
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((item: any) => item?.text ?? inlineText(item?.content)).join("");
}

/** BlockNote parses Markdown attachment links as ordinary inline links. Promote
 * only a standalone link into a file block; links embedded in prose remain
 * normal links. */
export function promoteLocalFileLinks(blocks: readonly any[]): any[] {
  return blocks.map((block) => {
    const content = Array.isArray(block.content) ? block.content : [];
    const link = content.length === 1 && content[0]?.type === "link" ? content[0] : null;
    const promoted = link && typeof link.href === "string" && isLocalAssetPath(link.href)
      ? {
          ...block,
          type: "file",
          props: {
            url: link.href,
            name: inlineText(link.content) || link.href.split("/").pop() || "attachment",
          },
          content: undefined,
        }
      : block;
    return {
      ...promoted,
      children: block.children?.length ? promoteLocalFileLinks(block.children) : (block.children ?? []),
    };
  });
}
