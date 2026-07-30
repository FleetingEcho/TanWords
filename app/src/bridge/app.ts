/** Replaces `@tauri-apps/api/app`. Used by `Layout/UpdateButton.tsx`. */
export async function getVersion(): Promise<string> {
  return (await window.tanwords?.call("app:version")) ?? "0.0.0";
}
export async function getName(): Promise<string> {
  return (await window.tanwords?.call("app:name")) ?? "TanWords";
}
