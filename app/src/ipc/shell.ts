/** Hand a URL to the OS default handler.
 *
 *  Main validates the scheme before calling `shell.openExternal` — an
 *  unvalidated openExternal is a remote-code-execution vector on Windows. */

import { callMain } from "./host";
import { isDesktopHost } from "@/platform";

export async function openExternal(url: string): Promise<void> {
  if (isDesktopHost) {
    await callMain("shell:open", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
