/** Replaces `@tauri-apps/api/window`. See ./README.md.
 *
 *  Only `useBrowserPanel.ts:86` uses this, to compute `viewportOffsetY()`:
 *      innerSize().height / scaleFactor() - window.innerHeight
 *  Under Tauri that converted viewport coords to physical window coords.
 *  Electron's WebContentsView.setBounds takes DIPs relative to the content
 *  area, so the correct offset is 0 — hence innerSize() reports the DIP height
 *  and scaleFactor() reports 1. Do not "fix" this to report real device
 *  pixels: a plausible-looking nonzero offset is what puts the browser panel
 *  over the page header (migration plan §8.4). */
export function getCurrentWindow() {
  return {
    async innerSize() {
      return { width: window.innerWidth, height: window.innerHeight };
    },
    async scaleFactor() {
      return 1;
    },
    async hide() {
      await window.tanwords?.call("window:hide");
    },
    async show() {
      await window.tanwords?.call("window:show");
    },
  };
}
