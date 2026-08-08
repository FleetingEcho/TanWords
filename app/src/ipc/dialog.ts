/** Native file dialogs, via the main process.
 *
 *  A cancelled dialog yields `null` (not `undefined`, not Electron's
 *  `{ canceled: true }`) — main unwraps the Electron shape; see
 *  electron/main/ipc.ts. */

import { callMain } from "./host";
import { isDesktopHost } from "@/platform";
import { webPickFiles, webPickFile, webDownloadBlob, webDownloadText } from "@/platform/webClient";

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
  if (!isDesktopHost) {
    throw new Error("openDialog is desktop-only; use pickFiles on web");
  }
  return callMain<string | string[] | null>("dialog:open", options);
}

export function saveDialog(
  options: { defaultPath?: string; filters?: DialogFilter[] } = {},
): Promise<string | null> {
  if (!isDesktopHost) {
    throw new Error("saveDialog is desktop-only; use downloadBlob on web");
  }
  return callMain<string | null>("dialog:save", options);
}

/** Pick a folder for a multi-file save (desktop only). The folder is recorded
 *  as a writable root for `writeBinaryFile` for the rest of the session. */
export function pickSaveDirectory(): Promise<string | null> {
  if (!isDesktopHost) {
    throw new Error("pickSaveDirectory is desktop-only");
  }
  return callMain<string | null>("dialog:pickSaveDir");
}

/** Write in-memory bytes to a path the user just picked via `saveDialog` or
 *  inside a folder from `pickSaveDirectory` (desktop only). Resolves once the
 *  bytes are flushed to disk, so callers can report genuine success/failure. */
export function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  if (!isDesktopHost) {
    throw new Error("writeBinaryFile is desktop-only");
  }
  return callMain<void>("file:writeBinary", { path, data });
}

export function pickFiles(options: { multiple?: boolean; accept?: string } = {}): Promise<File[]> {
  return webPickFiles(options);
}

export function pickFile(options: { accept?: string } = {}): Promise<File | null> {
  return webPickFile(options);
}

export function downloadBlob(filename: string, blob: Blob): void {
  webDownloadBlob(filename, blob);
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  webDownloadText(filename, text, mime);
}
