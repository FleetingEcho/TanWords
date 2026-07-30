/** Replaces `@tauri-apps/plugin-dialog`. Only `open` and `save` are used.
 *
 *  Return shapes matter: call sites do `typeof picked === "string"` and
 *  `if (picked)`, so a cancelled dialog must yield `null` — not undefined and
 *  not Electron's `{ canceled: true }`. Main is responsible for unwrapping. */
export type DialogFilter = { name: string; extensions: string[] };

export async function open(options: {
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
  filters?: DialogFilter[];
} = {}): Promise<string | string[] | null> {
  return (await window.tanwords?.call("dialog:open", options)) ?? null;
}

export async function save(options: {
  defaultPath?: string;
  filters?: DialogFilter[];
} = {}): Promise<string | null> {
  return (await window.tanwords?.call("dialog:save", options)) ?? null;
}
