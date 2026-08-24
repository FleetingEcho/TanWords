import React, { useCallback, useRef } from "react";
import type { NavPage } from "@/store/navStore";
import { useNavStore } from "@/store/navStore";
import { hostCapabilities } from "@/platform";
import { getPageDefinition } from "@/pages/pageCatalog";
import { PageFallback } from "@/pages/PageFallback";
import { StartupReadySignal } from "@/pages/StartupReadySignal";
import {
  activeRetained,
  effectiveMainPage,
  pageOwnsStartupReadiness,
  isMainBlockActive,
  type RetainedId,
} from "@/pages/pageHostResolve";
import { ReactPageAdapter } from "@/pages/adapters/ReactPageAdapter";
import { BrowserPageAdapter } from "@/pages/adapters/BrowserPageAdapter";
import { ToolsPageAdapter } from "@/pages/adapters/ToolsPageAdapter";
import { TerminalPageAdapter } from "@/pages/adapters/TerminalPageAdapter";
import { DshPageAdapter } from "@/pages/adapters/DshPageAdapter";
import { usePageHostUiStore } from "@/store/pageHostUiStore";

/** Params the page expects from navigation. Only vocabulary and chat take
 *  params today; every other page receives none. Read from navStore so the
 *  workspace pane host (Phase 3) can supply its own params from a
 *  `PageInstance` without this code changing. */
function useNavParams(page: NavPage): Record<string, any> | undefined {
  const wordId = useNavStore((s) => s.wordId);
  const sentenceId = useNavStore((s) => s.sentenceId);
  const chatSessionId = useNavStore((s) => s.chatSessionId);
  if (page === "vocabulary") return { initialWordId: wordId, initialSentenceId: sentenceId };
  if (page === "chat") return { initialSessionId: chatSessionId };
  return undefined;
}

/** Renders the main (non-retained) page behind a keyed Suspense. The key is the
 *  raw nav page so switching ordinary pages shows the spinner, exactly as the
 *  shell used to. */
function MainBlock({ page }: { page: NavPage }) {
  const effective = effectiveMainPage(page);
  const definition = getPageDefinition(effective);
  const params = useNavParams(effective);
  if (!definition) {
    // Every NavPage has a catalog entry (asserted by the completeness test),
    // so this is defensive only.
    return null;
  }
  const adapter =
    effective === "browser"
      ? <BrowserPageAdapter definition={definition} params={params} visible />
      : <ReactPageAdapter definition={definition} params={params} visible />;
  return (
    <React.Suspense key={page} fallback={<PageFallback />}>
      {adapter}
      {!pageOwnsStartupReadiness(page) && <StartupReadySignal />}
    </React.Suspense>
  );
}

export interface PageHostProps {
  /** The current nav destination. The shell reads navStore once (it also
   *  needs the page for chrome decisions) and passes it down so the host and
   *  shell stay in sync on a single read. */
  activePage: NavPage;
  /** Whether the full-page surface currently owns the layout. Workspaces hide
   *  this surface without unmounting it so retained Terminal and DSH sessions
   *  continue running in the background. */
  visible?: boolean;
}

/** Owns lazy loading, Suspense fallbacks, retained-page lifecycle, capability
 *  fallbacks, and startup-readiness signalling for the full-page destination.
 *
 *  This is the seam the catalog feeds. `App.tsx` no longer holds the page
 *  switch or the retained `visited` refs; it computes chrome (immersive,
 *  background blur) from the page and the host UI store, and delegates all
 *  page rendering here. Phase 3 adds a separate workspace pane host that
 *  reuses the same adapters with a `workspace`-mode `PageHostContext`. */
export function PageHost({ activePage, visible = true }: PageHostProps) {
  const page = activePage;
  const navigate = useNavStore((s) => s.navigate);

  // Retained visited set. Mutated during render exactly the way App.tsx's
  // boolean refs were: a retained page becomes "visited" the render it first
  // becomes active, and the block mounts in that same render. Idempotent
  // `add` survives StrictMode's double render.
  const visitedRef = useRef<Set<RetainedId>>(new Set());
  const retained = activeRetained(page);
  if (retained) visitedRef.current.add(retained);
  const visited = visitedRef.current;
  const visibleRetained = visible ? retained : null;

  // Closing the terminal tears down its PTYs: drop it from the retained set
  // and leave the route. Maximise is reset so a reopened terminal starts
  // un-maximized. The shell reads `terminalMaximized` from the same store to
  // compute `immersive`.
  const closeTerminal = useCallback(() => {
    visitedRef.current.delete("terminal");
    usePageHostUiStore.getState().setTerminalMaximized(false);
    navigate("dashboard");
  }, [navigate]);

  const toolsDef = getPageDefinition("tools");
  const terminalDef = getPageDefinition("terminal");
  const dshDef = getPageDefinition("dsh");

  const mainBlockActive = isMainBlockActive(page);

  return (
    <>
      {visited.has("terminal") && hostCapabilities.terminal && terminalDef && (
        <React.Suspense fallback={visibleRetained === "terminal" ? <PageFallback /> : null}>
          <TerminalPageAdapter
            definition={terminalDef}
            visible={visibleRetained === "terminal"}
            onClose={closeTerminal}
          />
          {visibleRetained === "terminal" && <StartupReadySignal />}
        </React.Suspense>
      )}
      {visited.has("tools") && toolsDef && (
        <React.Suspense fallback={visibleRetained === "tools" ? <PageFallback /> : null}>
          <ToolsPageAdapter definition={toolsDef} visible={visibleRetained === "tools"} />
          {visibleRetained === "tools" && <StartupReadySignal />}
        </React.Suspense>
      )}
      {visited.has("dsh") && hostCapabilities.dsh && dshDef && (
        <React.Suspense fallback={visibleRetained === "dsh" ? <PageFallback /> : null}>
          <DshPageAdapter definition={dshDef} visible={visibleRetained === "dsh"} />
          {visibleRetained === "dsh" && <StartupReadySignal />}
        </React.Suspense>
      )}
      {visible && mainBlockActive && <MainBlock page={page} />}
    </>
  );
}
