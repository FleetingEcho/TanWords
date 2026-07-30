/** Returns image blobs exposed by a clipboard paste. Kept outside React so the
 * desktop-WebView clipboard shape can be regression-tested directly. */
export function clipboardImageFiles(data: Pick<DataTransfer, "files" | "items">): File[] {
  const images = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (images.length > 0) return images;

  // WebKit-based desktop WebViews commonly leave DataTransfer.files empty for
  // screenshots while still exposing the blob as a clipboard item.
  return Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export async function clipboardImageFilesOrNative(
  data: Pick<DataTransfer, "files" | "items">,
  readNativeImage: () => Promise<File | null>,
): Promise<File[]> {
  const webImages = clipboardImageFiles(data);
  if (webImages.length > 0) return webImages;
  const nativeImage = await readNativeImage();
  return nativeImage ? [nativeImage] : [];
}
