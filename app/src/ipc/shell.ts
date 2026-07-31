/** Hand a URL to the OS default handler.
 *
 *  Main validates the scheme before calling `shell.openExternal` — an
 *  unvalidated openExternal is a remote-code-execution vector on Windows. */

import { callMain } from "./host";

export async function openExternal(url: string): Promise<void> {
  await callMain("shell:open", { url });
}
