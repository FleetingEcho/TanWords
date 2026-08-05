/**
 * Mermaid and YouTube as Tiptap nodes.
 *
 * The React views live in `MermaidView.tsx` / `YouTubeView.tsx` and are
 * imported rather than copied: the zoom/fullscreen/SVG-cache behaviour and the
 * iframe/URL-entry behaviour were unchanged by the migration off BlockNote, so
 * only the node wrapper is new here.
 *
 * Storage stays portable in both cases: a Mermaid block is a ```mermaid fence
 * in markdown and a YouTube block is a plain link, handled by
 * `mermaidTransforms` / `mediaTransforms` on the block side of the adapter.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { MermaidView } from "../../MermaidView";
import { YouTubeView } from "../../YouTubeView";

function MermaidNodeView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper data-block-type="mermaid">
      <MermaidView
        code={(node.attrs.code as string) ?? ""}
        onChange={(code) => updateAttributes({ code })}
      />
    </NodeViewWrapper>
  );
}

function YouTubeNodeView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper data-block-type="youtube">
      <YouTubeView
        url={(node.attrs.url as string) ?? ""}
        caption={(node.attrs.caption as string) ?? ""}
        onChange={(url) => updateAttributes({ url })}
      />
    </NodeViewWrapper>
  );
}

export const MermaidNode = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ code: { default: "" } }),
  parseHTML: () => [{ tag: 'pre[class="mermaid"]' }],
  // `documentExport.renderMermaidBlocks` finds diagrams by `pre.mermaid` and
  // replaces them with rendered SVG, so the export shape must stay exactly
  // this — see documentExport.ts:146.
  renderHTML: ({ node }) => ["pre", { class: "mermaid" }, (node.attrs.code as string) ?? ""],
  addNodeView: () => ReactNodeViewRenderer(MermaidNodeView),
});

export const YouTubeNode = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ url: { default: "" }, caption: { default: "" } }),
  parseHTML: () => [{ tag: 'div[data-block-type="youtube"]' }],
  // Exports as a plain link so the document stays readable anywhere else,
  // matching what `lowerYouTube` writes into markdown.
  renderHTML: ({ node, HTMLAttributes }) => [
    "p",
    mergeAttributes(HTMLAttributes, { "data-block-type": "youtube" }),
    ["a", { href: (node.attrs.url as string) ?? "" }, (node.attrs.caption || node.attrs.url || "") as string],
  ],
  addNodeView: () => ReactNodeViewRenderer(YouTubeNodeView),
});
