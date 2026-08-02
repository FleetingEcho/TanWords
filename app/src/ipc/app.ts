/** App identity, from Electron's own `app` module in main. */

import { callMain } from "./host";
import { isDesktopHost } from "@/platform";

export function getVersion(): Promise<string> {
  if (!isDesktopHost) return Promise.resolve("web");
  return callMain<string>("app:version");
}

export function getName(): Promise<string> {
  if (!isDesktopHost) return Promise.resolve("TanWords");
  return callMain<string>("app:name");
}

/** Quit and start again — used after an update is staged. */
export async function relaunch(): Promise<void> {
  if (isDesktopHost) await callMain("process:relaunch");
}

export async function exit(code = 0): Promise<void> {
  if (isDesktopHost) await callMain("process:exit", { code });
}
