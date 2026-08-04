/** Path arithmetic for importing local vault files into library folders.
 *
 * Kept out of LocalDocsView because this is the part with actual edge cases —
 * a wrong base silently files a hundred documents in the wrong place, and that
 * is not something a glance at the sidebar catches. */

/** The deepest directory every path shares.
 *
 * Subtracting it is what makes the library mirror the shape of what was picked
 * rather than the whole vault: select two files under `notes/rust` and they
 * land directly in the target folder, not in `target/notes/rust`. */
export function commonBase(relPaths: string[]): string {
  const dirs = relPaths.map((p) => p.split("/").slice(0, -1));
  if (dirs.length === 0) return "";
  let common = dirs[0];
  for (const segments of dirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < segments.length && common[i] === segments[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}

/** Where one file ends up: the target folder, plus whatever of its own
 *  directory path survives after `base` is stripped. */
export function targetFolder(relPath: string, base: string, target: string): string {
  const dir = relPath.slice(0, Math.max(0, relPath.lastIndexOf("/")));
  const suffix = base && (dir === base || dir.startsWith(`${base}/`))
    ? dir.slice(base.length).replace(/^\//, "")
    : dir;
  return [target, suffix].filter(Boolean).join("/");
}
