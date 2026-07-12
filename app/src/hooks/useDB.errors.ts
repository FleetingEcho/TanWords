import { toast } from "sonner";

/** Log every DB failure for debugging; only surface a toast for writes —
 *  a failed read already shows up as an empty/stale UI state. */
export function logError(op: string, err: unknown) {
  console.error(`[useDB] ${op} failed:`, err);
}

export function reportWriteError(op: string, err: unknown, message: string) {
  logError(op, err);
  toast.error(message);
}
