/** Replaces `@tauri-apps/plugin-clipboard-manager`.
 *  Only `readImage` is permitted today (see the old capabilities/default.json).
 *  Tauri returned an object with `.rgba()`/`.bytes()`; main sends a PNG
 *  data URL and this reshapes it to what the call site expects. */
export async function readImage() {
  const dataUrl: string | null = await window.tanwords?.call("clipboard:readImage");
  if (!dataUrl) throw new Error("clipboard is empty");
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  return { bytes: async () => bytes, rgba: async () => bytes };
}
export async function writeText(text: string): Promise<void> {
  await window.tanwords?.call("clipboard:writeText", { text });
}
export async function readText(): Promise<string> {
  return (await window.tanwords?.call("clipboard:readText")) ?? "";
}
