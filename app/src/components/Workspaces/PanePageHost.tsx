import React from "react";
import type { LayoutNode, PageInstance } from "@/workspaces/model";
import type { NavPage } from "@/store/navStore";
import { getPageDefinition } from "@/pages/pageCatalog";
import { PageHostProvider, type PageHostContextValue } from "@/pages/PageHostContext";
import { getLazyPage } from "@/pages/adapters/lazyPage";
import { usePageHostUiStore } from "@/store/pageHostUiStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { PageFallback } from "@/pages/PageFallback";
import { usePaneNativeVisibility } from "./usePaneNativeVisibility";

/** Renders one page instance inside a workspace pane, in `workspace` mode.
 *
 *  Reuses the same lazy component cache the full-page adapters use, so a page
 *  that is open both full-page and in a pane loads once. The host context
 *  carries the pane's `instanceId` and `visible` so retained/native pages can
 *  show/hide their native surface when the pane scrolls out of view or loses
 *  focus.
 *
 *  Native pages (browser, dsh) composite above the HTML via a child
 *  `WebContentsView`, so a pane hosting one is kept mounted (retained) and its
 *  native surface is hidden — through the existing block stores — while the
 *  pane is not the visible one. The page measures its own bounds from its
 *  placeholder element, so no per-pane bounds adapter is needed: the
 *  `ResizeObserver` the page already installs repositions the native view as
 *  the split divider moves. */
export interface PanePageHostProps {
  paneId: string;
  content: PageInstance;
  visible: boolean;
  /** Ask the workspace to focus this pane. */
  requestFocus: () => void;
  /** Ask the shell to open this page full-screen. */
  requestOpenFullPage: () => void;
}

export function PanePageHost({ paneId, content, visible, requestFocus, requestOpenFullPage }: PanePageHostProps) {
  const def = getPageDefinition(content.pageId);
  // The workspace pane host supplies params from the PageInstance; today
  // none of the pages carry params in a workspace, but the seam is here for
  // when they do.
  const params = content.params ?? undefined;
  const ctx: PageHostContextValue = {
    mode: "workspace",
    instanceId: content.instanceId,
    visible,
    requestFocus,
    requestOpenFullPage,
  };

  if (!def) return null;

  // Terminal in a pane maps its embedded "maximize" to app-wide immersive mode:
  // the owning pane is focused so siblings stay mounted but clipped, while the
  // application and workspace shells hide their chrome around this terminal.
  if (content.pageId === "terminal") {
    return <TerminalPaneHost def={def} paneId={paneId} visible={visible} ctx={ctx} params={params} />;
  }
  // tools/dsh/browser are retained/native pages kept mounted in the pane with
  // a `visible` prop. Browser and DSH additionally hide their native surface
  // (via the block stores) while the pane is not visible.
  if (content.pageId === "tools" || content.pageId === "dsh" || content.pageId === "browser") {
    return <RetainedPaneHost def={def} content={content} visible={visible} ctx={ctx} params={params} />;
  }
  return <ReactPaneHost def={def} params={params} ctx={ctx} />;
}

function ReactPaneHost({ def, params, ctx }: { def: ReturnType<typeof getPageDefinition>; params: any; ctx: PageHostContextValue }) {
  if (!def) return null;
  const Lazy = getLazyPage(def);
  return (
    <PageHostProvider value={ctx}>
      {/* The surrounding split tree collapses invisible panes to a clipped,
       * zero-size container. Keep the page mounted inside it so maximizing a
       * sibling never resets editors, forms, scroll state, or ongoing work. */}
      <Lazy {...(params ?? {})} />
    </PageHostProvider>
  );
}

function RetainedPaneHost({
  def, content, visible, ctx, params,
}: { def: NonNullable<ReturnType<typeof getPageDefinition>>; content: PageInstance; visible: boolean; ctx: PageHostContextValue; params: any }) {
  // Hide the native surface (browser/dsh) while this pane is not the visible
  // one. Ordinary retained pages (tools) just clip with the DOM.
  usePaneNativeVisibility(content.pageId, visible);
  if (!def) return null;
  const Lazy = getLazyPage(def);
  // tools/dsh/browser take a `visible` prop. A workspace pane keeps the
  // retained page mounted while it is the active pane's content; when the
  // pane is scrolled/focused away the page is hidden, not unmounted — so its
  // state (open tabs, DSH session) survives.
  const props: any = { visible, ...(params ?? {}) };
  return (
    <PageHostProvider value={ctx}>
      <Lazy {...props} />
    </PageHostProvider>
  );
}

function TerminalPaneHost({
  def, paneId, visible, ctx, params,
}: { def: NonNullable<ReturnType<typeof getPageDefinition>>; paneId: string; visible: boolean; ctx: PageHostContextValue; params: any }) {
  if (!def) return null;
  const Lazy = getLazyPage(def);
  const terminalMaximized = usePageHostUiStore((s) => s.terminalMaximized);
  const setMaximized = usePageHostUiStore((s) => s.setTerminalMaximized);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const maximized = terminalMaximized && focusedPaneId === paneId;
  const setTerminalImmersive = React.useCallback((value: boolean) => {
    // The terminal's own maximize button is app-wide immersive mode. Focus the
    // owning pane first so the split tree retains every sibling while rendering
    // only this terminal; restoring expands the original split geometry again.
    setFocus(value ? paneId : null);
    setMaximized(value);
  }, [paneId, setFocus, setMaximized]);
  // Terminal renders an xterm canvas inside the DOM (not a native
  // `WebContentsView`), so it clips behind a focused pane like any React page
  // — no native-surface hide is needed. In a pane, the terminal's embedded
  // close empties this pane (the workspace store collapses the tree) rather
  // than navigating to the full-page terminal route. The pane header's own
  // close button already calls the same store action.
  const onClose = React.useCallback(() => {
    if (maximized) setTerminalImmersive(false);
    useWorkspaceStore.getState().closePane(paneId);
  }, [maximized, paneId, setTerminalImmersive]);
  return (
    <PageHostProvider value={ctx}>
      <Lazy
        visible={visible}
        maximized={maximized}
        onMaximizedChange={setTerminalImmersive}
        onClose={onClose}
        {...(params ?? {})}
      />
    </PageHostProvider>
  );
}

/** Fallback shown while a pane's page chunk is still loading. */
export function PaneFallback() {
  return <PageFallback />;
}

/** Type guard for the renderer switch. */
export function isRenderable(pageId: NavPage): boolean {
  return !!getPageDefinition(pageId);
}

/** The render node for the recursive layout: a pane carries its content or
 *  nothing (empty panes render the pane chrome's "add page" affordance). */
export type PaneRender = { kind: "pane"; id: string; content: PageInstance | null } | { kind: "split-render"; node: LayoutNode };
