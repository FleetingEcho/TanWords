/**
 * The four media block nodes. Tiptap ships only `image`, so all four are
 * defined here to keep one consistent attr shape (plan.md §4b).
 *
 * Node names deliberately equal the stored block `type` strings — `image`,
 * `video`, `audio`, `file` — so `blockAdapter` needs no mapping table.
 *
 * All four are atoms: they render from attrs and hold no editable text, which
 * is what our storage format already assumes (`ATOM_BLOCKS` in `blocks.ts`).
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AudioView, FileView, ImageView, VideoView } from "./MediaView";

/** Attrs shared by every media block, mirroring the stored props. */
const MEDIA_ATTRS = {
  url: { default: "" },
  name: { default: "" },
  caption: { default: "" },
  backgroundColor: { default: "default" },
  textAlignment: { default: "left" },
  /** Set only while an upload is in flight; `blockAdapter` strips it so it
   *  never reaches storage. Its local preview lives in `pendingUploads`. */
  uploadId: { default: null, rendered: false },
};

interface MediaNodeOptions {
  name: "image" | "video" | "audio" | "file";
  view: Parameters<typeof ReactNodeViewRenderer>[0];
  extraAttrs?: Record<string, { default: unknown }>;
}

function createMediaNode({ name, view, extraAttrs }: MediaNodeOptions) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes: () => ({ ...MEDIA_ATTRS, ...extraAttrs }),

    // The DOM shape is what HTML export serializes to, so it carries the app
    // URL rather than a resolved one — `documentExport.inlineDocumentAssets`
    // scans the exported HTML for `tanwords-asset://` ids and swaps in data
    // URLs itself.
    parseHTML: () => [{ tag: `div[data-block-type="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) =>
      ["div", mergeAttributes(HTMLAttributes, { "data-block-type": name })],

    addNodeView: () => ReactNodeViewRenderer(view),
  });
}

export const ImageNode = createMediaNode({
  name: "image",
  view: ImageView,
  extraAttrs: {
    showPreview: { default: true },
    previewWidth: { default: null },
  },
});

export const VideoNode = createMediaNode({ name: "video", view: VideoView });
export const AudioNode = createMediaNode({ name: "audio", view: AudioView });
export const FileNode = createMediaNode({ name: "file", view: FileView });

export const MEDIA_NODES = [ImageNode, VideoNode, AudioNode, FileNode];
