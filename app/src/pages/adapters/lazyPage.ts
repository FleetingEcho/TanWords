import React from "react";
import type { PageDefinition } from "@/pages/pageCatalog";

/** One `React.lazy` wrapper per page definition, shared by every adapter.
 *
 *  A page may be rendered by the generic React adapter in full-page mode and
 *  by a dedicated adapter in workspace mode. Resolving both to the *same*
 *  lazy component means the underlying dynamic import is started once and
 *  the result is cached by React.lazy's own promise memo — two adapters
 *  mounting the same page don't race or double-load. Weakly keyed on the
 *  stable catalog entry so the cache never grows. */
const lazyCache = new WeakMap<PageDefinition, React.LazyExoticComponent<React.ComponentType<any>>>();

export function getLazyPage(def: PageDefinition): React.LazyExoticComponent<React.ComponentType<any>> {
  let c = lazyCache.get(def);
  if (!c) {
    c = React.lazy(def.load);
    lazyCache.set(def, c);
  }
  return c;
}
