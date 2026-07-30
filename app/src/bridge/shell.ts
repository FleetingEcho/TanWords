/** Replaces `@tauri-apps/plugin-shell`. Only `open` is used (4 call sites).
 *  Main must validate the scheme before calling shell.openExternal — an
 *  unvalidated openExternal is a remote-code-execution vector on Windows. */
export async function open(url: string): Promise<void> {
  await window.tanwords?.call("shell:open", { url });
}
