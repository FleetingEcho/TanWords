/** App identity, from Electron's own `app` module in main. */

import { callMain } from "./host";

export function getVersion(): Promise<string> {
  return callMain<string>("app:version");
}

export function getName(): Promise<string> {
  return callMain<string>("app:name");
}

/** Quit and start again — used after an update is staged. */
export async function relaunch(): Promise<void> {
  await callMain("process:relaunch");
}

export async function exit(code = 0): Promise<void> {
  await callMain("process:exit", { code });
}
