/**
 * Local previews for in-flight uploads.
 *
 * A pasted image should appear instantly, but its `tanwords-asset://` URL does
 * not exist until the upload resolves — and for a large file routed to R2 that
 * is a multi-second round trip. BlockNote inserted optimistically and swapped
 * the URL on completion; this is the same trick.
 *
 * The object URL is held HERE rather than in a node attr, because attrs are
 * serialized: an autosave firing mid-upload would otherwise write a `blob:`
 * URL into the stored document. The node carries only an opaque `uploadId`,
 * which `blockAdapter` strips on the way to storage.
 */
const previews = new Map<string, string>();
let sequence = 0;

export function startPendingUpload(file: File): { uploadId: string; previewUrl: string } {
  const uploadId = `pending-${++sequence}`;
  const previewUrl = URL.createObjectURL(file);
  previews.set(uploadId, previewUrl);
  return { uploadId, previewUrl };
}

export function pendingPreviewUrl(uploadId: string | null | undefined): string | null {
  return uploadId ? previews.get(uploadId) ?? null : null;
}

/** Releases the object URL. Safe to call more than once. */
export function finishPendingUpload(uploadId: string): void {
  const url = previews.get(uploadId);
  if (!url) return;
  previews.delete(uploadId);
  URL.revokeObjectURL(url);
}
