/** Deterministic, collision-resistant id minting for workspace nodes and
 *  page instances.
 *
 *  Uses `crypto.randomUUID` where available (Electron, modern browsers, Node
 *  test runtime) and falls back to a compact base36 timestamp+random scheme.
 *  Both forms are URL-safe strings; the model treats ids as opaque. */
function uuidLike(): string {
  const g = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A monotonic counter combined with the uuid so two ids minted in the same
 *  millisecond still differ — useful in tests that build a tree in a tight
 *  loop and would otherwise risk collisions on the fallback path. */
let counter = 0;
function next(): string {
  counter = (counter + 1) % 1_000_000;
  return `ws-${uuidLike()}-${counter.toString(36)}`;
}

export function newPaneId(): string {
  return `pane-${next()}`;
}

export function newSplitId(): string {
  return `split-${next()}`;
}

export function newInstanceId(): string {
  return `inst-${next()}`;
}

export function newWorkspaceId(): string {
  return `ws-${next()}`;
}

/** Reset the counter. Tests use this so id sequences don't drift across files
 *  when one asserts on counts rather than exact ids. */
export function __resetIdsForTests(): void {
  counter = 0;
}
