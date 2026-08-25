import React from "react";
import type { LayoutNode } from "@/workspaces/model";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { WorkspacePane } from "./WorkspacePane";
import { Divider } from "./Divider";

/** Recursively-sized split layout with a flat pane layer.
 *
 * React cannot preserve a component when it moves beneath a newly-created
 * parent. A split wraps the target leaf in a split node, so rendering the model
 * recursively used to unmount the existing WorkspacePane (and therefore close
 * a live terminal) before mounting it again below the new branch. Panes are now
 * stable, keyed siblings; only their absolute geometry changes when the split
 * tree changes. The recursive layer beneath them owns divider sizing only. */
export interface SplitLayoutProps {
  node: LayoutNode;
  visible: boolean;
}

type Bounds = { left: number; right: number; top: number; bottom: number };
type PositionedPane = {
  pane: Extract<LayoutNode, { kind: "pane" }>;
  bounds: Bounds;
};

export function SplitLayout({ node, visible }: SplitLayoutProps) {
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const editMode = useWorkspaceStore((s) => s.editMode);
  const panes = React.useMemo(() => positionPanes(node), [node]);
  const hasFocusedPane = focusedPaneId != null && panes.some(({ pane }) => pane.id === focusedPaneId);

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden">
      {panes.map(({ pane, bounds }) => {
        const focused = hasFocusedPane && pane.id === focusedPaneId;
        const hidden = hasFocusedPane && !focused;
        return (
          <div
            key={pane.id}
            aria-hidden={hidden || undefined}
            className={hidden ? "absolute h-0 w-0 overflow-hidden" : "absolute min-h-0 min-w-0 overflow-hidden"}
            style={hidden ? undefined : focused ? { inset: 0 } : paneStyle(bounds)}
          >
            <React.Suspense fallback={null}>
              <WorkspacePane
                paneId={pane.id}
                content={pane.content}
                visible={visible && !hidden}
                editMode={hasFocusedPane ? false : editMode}
                focused={focused}
              />
            </React.Suspense>
          </div>
        );
      })}
      {!hasFocusedPane && (
        <div className="pointer-events-none absolute inset-0">
          <DividerLayout node={node} />
        </div>
      )}
    </div>
  );
}

/** Recursive sizing skeleton. It deliberately renders no page content: pane
 * lifetimes belong to the stable sibling layer above. */
function DividerLayout({ node }: { node: LayoutNode }) {
  if (node.kind === "pane") return <div className="h-full w-full" />;
  return <SplitBranch node={node} />;
}

function SplitBranch({ node }: { node: Extract<LayoutNode, { kind: "split" }> }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const horizontal = node.axis === "horizontal";
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
        <DividerLayout node={node.first} />
      </div>
      <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
        <DividerLayout node={node.second} />
      </div>
      <Divider splitId={node.id} axis={node.axis} containerRef={containerRef} ratioPct={ratioPct} />
    </div>
  );
}

function positionPanes(root: LayoutNode): PositionedPane[] {
  const panes: PositionedPane[] = [];
  const visit = (node: LayoutNode, bounds: Bounds) => {
    if (node.kind === "pane") {
      panes.push({ pane: node, bounds });
      return;
    }
    if (node.axis === "horizontal") {
      const middle = bounds.left + (bounds.right - bounds.left) * node.ratio;
      visit(node.first, { ...bounds, right: middle });
      visit(node.second, { ...bounds, left: middle });
    } else {
      const middle = bounds.top + (bounds.bottom - bounds.top) * node.ratio;
      visit(node.first, { ...bounds, bottom: middle });
      visit(node.second, { ...bounds, top: middle });
    }
  };
  visit(root, { left: 0, right: 1, top: 0, bottom: 1 });
  return panes;
}

/** Match the recursive flex layout's four-pixel gutters while keeping every
 * pane wrapper under one stable React parent. */
function paneStyle(bounds: Bounds): React.CSSProperties {
  const leftInset = bounds.left > 0 ? 2 : 0;
  const rightInset = bounds.right < 1 ? 2 : 0;
  const topInset = bounds.top > 0 ? 2 : 0;
  const bottomInset = bounds.bottom < 1 ? 2 : 0;
  return {
    left: offset(bounds.left, leftInset),
    top: offset(bounds.top, topInset),
    width: span(bounds.right - bounds.left, leftInset + rightInset),
    height: span(bounds.bottom - bounds.top, topInset + bottomInset),
  };
}

function offset(fraction: number, pixels: number): string {
  const percentage = `${fraction * 100}%`;
  return pixels === 0 ? percentage : `calc(${percentage} + ${pixels}px)`;
}

function span(fraction: number, pixels: number): string {
  const percentage = `${fraction * 100}%`;
  return pixels === 0 ? percentage : `calc(${percentage} - ${pixels}px)`;
}
