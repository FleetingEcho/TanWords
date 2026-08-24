import React from "react";
import type { PageDefinition } from "@/pages/pageCatalog";
import { PageHostProvider, type PageHostContextValue } from "@/pages/PageHostContext";
import { usePageHostUiStore } from "@/store/pageHostUiStore";
import { getLazyPage } from "./lazyPage";

export interface TerminalPageAdapterProps {
  definition: PageDefinition;
  /** True while the Terminal route is the active destination. The PTYs stay
   *  alive (retained) while the page is merely hidden; only an explicit close
   *  tears them down. */
  visible: boolean;
  /** Tearing down the terminal: drops it from the retained set and navigates
   *  away. The maximize state is reset here too, so a reopened terminal does
   *  not inherit the previous session's fullscreen. */
  onClose: () => void;
  hostContext?: PageHostContextValue;
}

/** Retained renderer for the Terminal page. Owns the lazy load, the visible
 *  toggle, and the embedded "maximize" state. The maximize boolean lives in
 *  `pageHostUiStore` rather than local state so the application shell can read
 *  it to compute `immersive`/`disableBlur` without a callback prop threaded
 *  back up through the host.
 *
 *  The caller (`PageHost`) owns the Suspense boundary and the visited
 *  lifecycle (mount once, stay mounted until close). */
export function TerminalPageAdapter({ definition, visible, onClose, hostContext }: TerminalPageAdapterProps) {
  const Lazy = getLazyPage(definition);
  const maximized = usePageHostUiStore((s) => s.terminalMaximized);
  const setMaximized = usePageHostUiStore((s) => s.setTerminalMaximized);
  const ctx: PageHostContextValue = hostContext ?? {
    mode: "full",
    instanceId: definition.id,
    visible,
    requestFocus: () => {},
    requestOpenFullPage: () => {},
  };
  return (
    <PageHostProvider value={ctx}>
      <Lazy
        visible={visible}
        maximized={maximized}
        onMaximizedChange={setMaximized}
        onClose={onClose}
      />
    </PageHostProvider>
  );
}
