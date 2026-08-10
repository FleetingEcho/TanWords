import React from "react";

/** Row density for the library list, shared between DocSelector (owner),
 *  DocSelectorHeader (the toggle) and DocShelfList (renderDoc). */
export type DocListDensity = "compact" | "comfortable";

/** Persisted under a fixed key, the same convention useDocList's kin use.
 *  Default is comfortable: that is the recognizing-a-document mode the flat
 *  shelf is for; compact stays for inside-the-folder-tree navigation. */
export const DENSITY_KEY = "tanwords_doc_list_density";

export const DEFAULT_DENSITY: DocListDensity = "comfortable";

export function readDensity(): DocListDensity {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

/** Owns the density preference, reading it once and persisting every change. */
export function useDensity(): [DocListDensity, (next: DocListDensity) => void] {
  const [density, setDensity] = React.useState<DocListDensity>(readDensity);
  const change = React.useCallback((next: DocListDensity) => {
    setDensity(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch { /* storage may be unavailable */ }
  }, []);
  return [density, change];
}