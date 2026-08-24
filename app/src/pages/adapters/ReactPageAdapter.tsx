import React from "react";
import type { PageDefinition } from "@/pages/pageCatalog";
import { PageHostProvider, type PageHostContextValue } from "@/pages/PageHostContext";
import { getLazyPage } from "./lazyPage";

export interface ReactPageAdapterProps {
  definition: PageDefinition;
  /** Params forwarded to the page component. In full-page mode these come
   *  from navStore (e.g. `initialWordId`); in workspace mode they come from the
   *  pane's `PageInstance`. Pages that take no props receive `{}`. */
  params?: Record<string, any>;
  /** Whether the page is on screen. The caller owns the Suspense boundary and
   *  the retained lifecycle; this adapter only renders the page (or nothing
   *  when hidden) so a hidden mount never paints. */
  visible?: boolean;
  /** Host context value. The adapter supplies a sensible full-mode default so
   *  callers that don't care (ordinary full-page navigation) don't have to. */
  hostContext?: PageHostContextValue;
}

/** Renders one ordinary React page. The caller wraps this in a `Suspense`
 *  boundary and owns the retained lifecycle; this adapter is a pure renderer
 *  behind `PageHostProvider`. Most pages render through this unchanged; only
 *  pages with a real viewport or native-lifecycle exception get a dedicated
 *  adapter (Terminal, Browser, DSH).
 *
 *  The adapter does not add an `embedded` prop to pages. Host facts a page
 *  truly needs arrive through `PageHostContext`; everything else stays in the
 *  page's own props or the stores it already imports. */
export function ReactPageAdapter({
  definition,
  params,
  visible = true,
  hostContext,
}: ReactPageAdapterProps) {
  const Lazy = getLazyPage(definition);
  const ctx: PageHostContextValue = hostContext ?? {
    mode: "full",
    instanceId: definition.id,
    visible,
    requestFocus: () => {},
    requestOpenFullPage: () => {},
  };
  return (
    <PageHostProvider value={ctx}>
      {visible && <Lazy {...(params ?? {})} />}
    </PageHostProvider>
  );
}
