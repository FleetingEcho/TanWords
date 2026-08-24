import React from "react";
import type { LayoutNode } from "@/workspaces/model";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { WorkspacePane } from "./WorkspacePane";
import { Divider } from "./Divider";

/** Recursively renders a split tree. A pane renders its content (or the empty
 *  affordance); a split renders its two children with a draggable divider
 *  whose position follows the split's ratio.
 *
 *  Focus mode: when `focusedPaneId` is set, the focused pane fills the whole
 *  workspace while the rest of the tree is retained (the plan's "workspace
 *  focus" — distinct from global zenMode). The unfocused panes are kept
 *  mounted but hidden (`visible=false`, zero size) rather than unmounted, so
 *  every page keeps its live state through a maximize/restore round-trip. */
export interface SplitLayoutProps {
  node: LayoutNode;
  /** True when this subtree is on screen (not scrolled/hidden). Passed down so
   *  retained/native panes can hide their surfaces while off-screen. */
  visible: boolean;
}

export function SplitLayout({ node, visible }: SplitLayoutProps) {
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const editMode = useWorkspaceStore((s) => s.editMode);

  // Focus mode: if the focused pane is inside this subtree, render only it
  // filling the workspace. We check at every level so the focused pane's
  // ancestors collapse to it.
  if (focusedPaneId) {
    if (containsPane(node, focusedPaneId)) {
      if (node.kind === "pane" && node.id === focusedPaneId) {
        return <WorkspacePane paneId={node.id} content={node.content} visible={visible} editMode={false} focused />;
      }
      if (node.kind === "split") {
        if (containsPane(node.first, focusedPaneId)) {
          return <SplitLayout node={node.first} visible={visible} />;
        }
        return <SplitLayout node={node.second} visible={visible} />;
      }
    }
    // Focused pane is elsewhere: this subtree is kept mounted but hidden, so a
    // page here does not tear down during focus mode. It takes
    // no space (the focused pane fills the workspace) and reports `visible`
    // false so its native surface hides.
    return <HiddenPane node={node} />;
  }

  if (node.kind === "pane") {
    return <WorkspacePane paneId={node.id} content={node.content} visible={visible} editMode={editMode} focused={false} />;
  }

  return <SplitBranch node={node} visible={visible} />;
}

/** A subtree that is mounted but takes no space and reports itself not
 *  visible — used for the parts of the tree outside the focused pane, so
 *  all pages survive focus mode. Recurses so every pane under
 *  this subtree renders its (hidden) WorkspacePane. */
function HiddenPane({ node }: { node: LayoutNode }) {
  if (node.kind === "pane") {
    return (
      <div className="absolute h-0 w-0 overflow-hidden" aria-hidden>
        <WorkspacePane paneId={node.id} content={node.content} visible={false} editMode={false} focused={false} />
      </div>
    );
  }
  return (
    <div className="absolute h-0 w-0 overflow-hidden" aria-hidden>
      <HiddenPane node={node.first} />
      <HiddenPane node={node.second} />
    </div>
  );
}

/** A split node's two children plus a divider. Has its own container ref so
 *  the divider's pointer math is local to this branch — the recursive tree can
 *  have many dividers, each measuring its own bounding box. */
function SplitBranch({ node, visible }: { node: Extract<LayoutNode, { kind: "split" }>; visible: boolean }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const horizontal = node.axis === "horizontal";
  // Keep the persisted ratio at the centre of a 4px gutter. Subtracting half
  // the gutter from the first child prevents `ratio + gap` from making the
  // branch overflow, while the flexing second child consumes the remainder.
  const ratioPct = `${node.ratio * 100}%`;
  const firstSize = `calc(${ratioPct} - 2px)`;
  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full min-w-0 min-h-0 gap-1 overflow-hidden ${horizontal ? "flex-row" : "flex-col"}`}
    >
      <div
        className={`min-w-0 min-h-0 shrink-0 overflow-hidden ${horizontal ? "h-full" : "w-full"}`}
        style={horizontal ? { width: firstSize } : { height: firstSize }}
      >
        <SplitLayout node={node.first} visible={visible} />
      </div>
      <div
        className="min-w-0 min-h-0 flex-1 overflow-hidden"
      >
        <SplitLayout node={node.second} visible={visible} />
      </div>
      <Divider splitId={node.id} axis={node.axis} containerRef={containerRef} ratioPct={ratioPct} />
    </div>
  );
}

/** Does `node` contain a pane with `paneId`? */
function containsPane(node: LayoutNode, paneId: string): boolean {
  if (node.kind === "pane") return node.id === paneId;
  return containsPane(node.first, paneId) || containsPane(node.second, paneId);
}
