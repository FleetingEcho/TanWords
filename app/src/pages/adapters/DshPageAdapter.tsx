import React from "react";
import type { PageDefinition } from "@/pages/pageCatalog";
import { PageHostProvider, type PageHostContextValue } from "@/pages/PageHostContext";
import { getLazyPage } from "./lazyPage";

export interface DshPageAdapterProps {
  definition: PageDefinition;
  /** True while the DSH route is the active destination. The supervised host
   *  and its `WebContentsView` stay alive (retained) across ordinary
   *  navigation; `visible` only toggles the native view. */
  visible: boolean;
  hostContext?: PageHostContextValue;
}

/** Retained renderer for the DSH page. The caller (`PageHost`) owns the
 *  Suspense boundary and the visited lifecycle; this adapter owns the lazy
 *  load and the visible toggle. */
export function DshPageAdapter({ definition, visible, hostContext }: DshPageAdapterProps) {
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
