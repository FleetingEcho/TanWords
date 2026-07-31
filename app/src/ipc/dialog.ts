/** Native file dialogs, via the main process.
 *
 *  A cancelled dialog yields `null` (not `undefined`, not Electron's
 *  `{ canceled: true }`) — main unwraps the Electron shape; see
 *  electron/main/ipc.ts. */

import { callMain } from "./host";

export type DialogFilter = { name: string; extensions: string[] };

export type OpenDialogOptions = {
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
  filters?: DialogFilter[];
};

export function openDialog(options: OpenDialogOptions & { multiple: true }): Promise<string[] | null>;
export function openDialog(options?: OpenDialogOptions): Promise<string | null>;
export function openDialog(options: OpenDialogOptions = {}): Promise<string | string[] | null> {
  return callMain<string | string[] | null>("dialog:open", options);
}

export function saveDialog(
  options: { defaultPath?: string; filters?: DialogFilter[] } = {},
): Promise<string | null> {
  return callMain<string | null>("dialog:save", options);
}
