/** A monotonic ISO-8601 timestamp generator.
 *
 *  `new Date().toISOString()` can return the same string twice when called
 *  within the same millisecond — which happens routinely in tests and in fast
 *  sequential operations. The workspace store uses `updatedAt` for undo
 *  checkpoint ordering and for "which workspace changed last", so two equal
 *  timestamps would lose information. This helper guarantees strictly
 *  increasing values: if the next clock reading is not greater than the last,
 *  it bumps by one millisecond. */
let last = 0;

export function monotonicIso(): string {
  let t = Date.now();
  if (t <= last) t = last + 1;
  last = t;
  return new Date(t).toISOString();
}

/** Reset the monotonic clock's baseline. Tests use this so the sequence is
 *  deterministic and independent of other suites. */
export function __resetClockForTests(): void {
  last = 0;
}
