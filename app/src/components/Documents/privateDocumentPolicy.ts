export type PrivateAttachmentAction = "download" | "delete";

/** Editing unlocks content, but extracting or destroying private data requires
 * a fresh password challenge for each action. */
export function requiresAttachmentPassword(
  protectedDocument: boolean,
  action: PrivateAttachmentAction,
): boolean {
  return protectedDocument && (action === "download" || action === "delete");
}
