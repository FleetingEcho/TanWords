/** Native clipboard reads, for what the DOM clipboard API can't give us.
 *
 *  Only images are read natively: on some desktop platforms a copied image is
 *  advertised on the clipboard but never surfaces as a `File` in a paste
 *  event's DataTransfer, so `LocalDocEditor` falls back to this. Text goes
 *  through `navigator.clipboard` everywhere else in the app. */

import { callMain } from "./host";
import { isDesktopHost } from "@/platform";

/** The clipboard's image as a PNG `File`, or `null` if it holds no image.
 *
 *  Main returns a PNG data URL (Electron's `nativeImage.toDataURL()`), which
 *  `fetch` decodes for us — no canvas round-trip and no raw RGBA buffer
 *  crossing the IPC boundary. */
export async function readClipboardImage(): Promise<File | null> {
  if (!isDesktopHost) {
    try {
      if (!navigator.clipboard?.read) return null;
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        if (blob.size === 0) return null;
        const ext = type.split("/")[1] || "png";
        return new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
      }
      return null;
    } catch {
      return null;
    }
  }

  const dataUrl = await callMain<string | null>("clipboard:readImage");
  if (!dataUrl) return null;
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.size === 0) return null;
  return new File([blob], `clipboard-${Date.now()}.png`, { type: "image/png" });
}
