import type { PartialBlock } from "@blocknote/core";

function inlineToText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("");
  }
  return "";
}

/** After markdown parse: ```mermaid fences become rendered Mermaid blocks. */
export function liftMermaid(blocks: PartialBlock[]): any[] {
  return blocks.map((b: any) => {
    if (b.type === "codeBlock" && b.props?.language === "mermaid") {
      return { type: "mermaid", props: { code: inlineToText(b.content) } };
    }
    if (b.children?.length) return { ...b, children: liftMermaid(b.children) };
    return b;
  });
}

/** Before markdown export: Mermaid blocks become portable code fences. */
export function lowerMermaid(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b.type === "mermaid") {
      return {
        type: "codeBlock",
        props: { language: "mermaid" },
        content: [{ type: "text", text: b.props?.code ?? "", styles: {} }],
      };
    }
    if (b.children?.length) return { ...b, children: lowerMermaid(b.children) };
    return b;
  });
}
