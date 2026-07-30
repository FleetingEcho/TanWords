/** Replaces `@tauri-apps/plugin-process`. Used by `store/updaterStore.ts`. */
export async function relaunch(): Promise<void> {
  await window.tanwords?.call("process:relaunch");
}
export async function exit(code = 0): Promise<void> {
  await window.tanwords?.call("process:exit", { code });
}
