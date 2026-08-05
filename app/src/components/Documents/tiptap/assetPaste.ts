/**
 * Paste / attach a file → upload → render, as a ProseMirror plugin.
 *
 * This replaces BlockNote's internal paste pipeline, which called the
 * `uploadFile` editor option (plan.md §4c). `DocEditor` had NO paste handler of
 * its own and relied on that pipeline entirely, so without this, pasting an
 * image into a database-backed document silently stops working.
 *
 * Routing to R2 vs. the local database is decided downstream by
 * `uploadDocumentAsset` — nothing here knows or cares which happened. All this
 * layer owns is: insert immediately, swap in the real URL when it lands, and
 * clean up if it fails.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { clipboardImageFiles, clipboardImageFilesOrNative } from "../clipboardImages";
import { finishPendingUpload, startPendingUpload } from "./pendingUploads";

export interface AssetPasteOptions {
  /** Stores the file and resolves to a `tanwords-asset://<id>` URL. */
  upload: ((file: File) => Promise<string>) | null;
  /** Desktop clipboard fallback — see `clipboardImageFilesOrNative`. */
  readNativeImage: (() => Promise<File | null>) | null;
  onError: ((message: string) => void) | null;
  /** Fired after the document changes, so the caller can arm its autosave. */
  onChanged: (() => void) | null;
}

/** The block type a file becomes, by MIME. Mirrors `insertAttachment`. */
export function blockTypeForFile(file: File): "image" | "video" | "audio" | "file" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

/** Replaces the pending node's attrs, wherever it has drifted to by now.
 *  Positions are not stable across an async upload — the user keeps typing —
 *  so the node is found by its `uploadId` rather than a remembered position. */
function patchPendingNode(
  editor: Editor,
  uploadId: string,
  attrs: Record<string, unknown> | null,
): void {
  const { state, view } = editor;
  let target: { pos: number; nodeSize: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (node.attrs?.uploadId === uploadId) target = { pos, nodeSize: node.nodeSize };
    return !target;
  });
  if (!target) return;

  const { pos, nodeSize } = target;
  const tr = attrs
    ? state.tr.setNodeMarkup(pos, undefined, {
        ...state.doc.nodeAt(pos)?.attrs,
        ...attrs,
        uploadId: null,
      })
    // Upload failed: take the placeholder out rather than leave a permanent
    // spinner the user cannot remove.
    : state.tr.delete(pos, pos + nodeSize);
  view.dispatch(tr);
}

/** Inserts a placeholder, uploads, then swaps in the stored URL. */
export async function insertUploadedFile(
  editor: Editor,
  file: File,
  options: Pick<AssetPasteOptions, "upload" | "onError" | "onChanged">,
): Promise<void> {
  if (!options.upload) return;
  const type = blockTypeForFile(file);
  const { uploadId } = startPendingUpload(file);

  editor
    .chain()
    .focus()
    .insertContent({
      type,
      attrs: { url: "", name: file.name || "attachment", uploadId },
    })
    .run();
  options.onChanged?.();

  try {
    const url = await options.upload(file);
    patchPendingNode(editor, uploadId, { url, name: file.name || "attachment" });
    options.onChanged?.();
  } catch (error) {
    patchPendingNode(editor, uploadId, null);
    options.onError?.(String(error));
  } finally {
    finishPendingUpload(uploadId);
  }
}

export const AssetPaste = Extension.create<AssetPasteOptions>({
  name: "assetPaste",

  addOptions: () => ({
    upload: null,
    readNativeImage: null,
    onError: null,
    onChanged: null,
  }),

  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;

    return [
      new Plugin({
        key: new PluginKey("assetPaste"),
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData;
            if (!data || !options.upload) return false;

            const images = clipboardImageFiles(data);
            // Some desktop WebViews advertise an image type but expose no
            // File at all — the native clipboard is the only way to reach it,
            // so claim the paste before the default handler inserts nothing.
            const advertisesImage = Array.from(data.types).some((type) => type.startsWith("image/"));
            if (images.length === 0 && !advertisesImage) return false;

            void (async () => {
              const files = await clipboardImageFilesOrNative(
                data,
                options.readNativeImage ?? (async () => null),
              );
              for (const file of files) await insertUploadedFile(editor, file, options);
            })();
            return true;
          },

          handleDrop: (_view, event) => {
            const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
            if (files.length === 0 || !options.upload) return false;
            event.preventDefault();
            void (async () => {
              for (const file of files) await insertUploadedFile(editor, file, options);
            })();
            return true;
          },
        },
      }),
    ];
  },
});
