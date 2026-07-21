/** WebKitGTK's GStreamer media backend has no source element for Tauri's
 * custom `asset://` scheme — it only understands schemes it can open itself
 * (http/https/file/blob/data), so `<audio src="asset://...">` fails there
 * with MEDIA_ERR_SRC_NOT_SUPPORTED even though the same URL loads fine via
 * fetch() (macOS/Windows don't have this gap). Fetching it ourselves and
 * handing the element a fresh `blob:` URL sidesteps the missing GStreamer
 * element entirely.
 *
 * Callers own the returned URL: if it's a `blob:` URL (i.e. different from
 * the input), revoke it with URL.revokeObjectURL once done. Non-local URLs
 * (real remote podcast enclosures) are returned unchanged. */
export async function toPlayableSrc(url: string): Promise<string> {
  if (!url.startsWith("asset://") && !/^https?:\/\/asset\.localhost\//.test(url)) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load audio (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
