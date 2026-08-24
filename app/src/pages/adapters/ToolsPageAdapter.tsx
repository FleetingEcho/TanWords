import React from "react";
import type { PageDefinition } from "@/pages/pageCatalog";
import { PageHostProvider, type PageHostContextValue } from "@/pages/PageHostContext";
import { getLazyPage } from "./lazyPage";

export interface ToolsPageAdapterProps {
  definition: PageDefinition;
  /** True while the Tools route is the active destination. The page stays
   *  mounted (retained) once first visited; `visible` only toggles its
   *  display so an in-progress utility does not reset during navigation. */
  visible: boolean;
  hostContext?: PageHostContextValue;
}

/** Retained renderer for the Tools page. The caller (`PageHost`) owns the
 *  Suspense boundary and the visited/retained lifecycle (mount once, stay
 *  mounted); this adapter owns the lazy load and the visible toggle that used
 *  to live in `App.tsx`. */
export function ToolsPageAdapter({ definition, visible, hostContext }: ToolsPageAdapterProps) {
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
      <Lazy visible={visible} />
    </PageHostProvider>
  );
}
