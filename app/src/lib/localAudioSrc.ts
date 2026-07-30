/** Historically this worked around WebKitGTK's GStreamer media backend having
 * no source element for Tauri's custom `asset://` scheme (it only understood
 * schemes it could open itself, so `<audio src="asset://...">` failed there
 * with MEDIA_ERR_SRC_NOT_SUPPORTED even though the same URL loaded fine via
 * fetch()), by fetching the file and handing the element a `blob:` URL.
 *
 * Chromium (Electron's renderer) has no such gap, and the sidecar's /asset
 * HTTP endpoint supports Range requests — see migration plan §8.3. Loading
 * the whole file into a blob would defeat Range support and break seeking on
 * long podcasts, so this is now a pass-through. */
export async function toPlayableSrc(url: string): Promise<string> {
  return url;
}
