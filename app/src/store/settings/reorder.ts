/** Validates a persisted order array against the known id space: keeps ids
 *  that still exist, in their saved sequence, and appends any id from `all`
 *  that the saved list predates (a newly added sidebar tab / top-bar item)
 *  at the end — so a future upgrade's new item shows up rather than vanishing
 *  because it's absent from an order saved before it existed. */
export function normalizeOrder<T>(saved: unknown[], all: readonly T[]): T[] {
  const allSet = new Set<unknown>(all);
  const seen = new Set<unknown>();
  const kept: T[] = [];
  for (const id of saved) {
    if (allSet.has(id) && !seen.has(id)) {
      kept.push(id as T);
      seen.add(id);
    }
  }
  for (const id of all) {
    if (!seen.has(id)) kept.push(id);
  }
  return kept;
}

/** Merges a reordered subset (e.g. the ids shown, and dragged, in one
 *  Settings pill grid — already filtered to this host's capabilities) back
 *  into the full stored order, without disturbing where any other id sits.
 *  Walks the full order and, at each slot that belongs to the subset, drops
 *  in the next id from the freshly-dragged sequence. */
export function mergeReorderedSubset<T>(fullOrder: T[], newSubsetOrder: T[]): T[] {
  const subsetSet = new Set(newSubsetOrder);
  let i = 0;
  return fullOrder.map((id) => (subsetSet.has(id) ? newSubsetOrder[i++] : id));
}
