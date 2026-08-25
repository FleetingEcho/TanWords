import React from "react";
import type { PageInstance } from "@/workspaces/model";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { PaneHeader } from "./PaneHeader";
import { PanePageHost } from "./PanePageHost";
import { PagePicker } from "./PagePicker";
import { DropZones, PAGE_DRAG_MIME } from "./DropZones";
import { DEFAULT_WORKSPACE_APPEARANCE, normalizeWorkspaceAppearance } from "@/workspaces/model";
import { usePageHostUiStore } from "@/store/pageHostUiStore";

/** One pane of a workspace: a header, the hosted page (or the empty
 *  affordance), the page picker when adding/replacing, and the drag drop
 *  zones while a page is being dragged onto the pane.
 *
 *  The pane body is the scroll container for the hosted page (the plan's "a
 *  hosted page gets its own scroll container; MainLayout cannot remain the
 *  sole scroll owner"). Most ordinary React pages render a `w-full` root with
 *  vertical padding and rely on the parent to scroll; giving the pane body
 *  `overflow-y-auto` lets those pages scroll inside their pane without each
 *  one having to adopt a new scroll contract. Pages that manage their own
 *  internal scroll (editor panes, feeds lists) keep working because the body
 *  also allows `overflow-hidden` children to clip correctly. */
export interface WorkspacePaneProps {
  paneId: string;
  content: PageInstance | null;
  visible: boolean;
  editMode: boolean;
  focused: boolean;
}

export function WorkspacePane({ paneId, content, visible, editMode, focused }: WorkspacePaneProps) {
  const place = useWorkspaceStore((s) => s.place);
  const selectedPaneId = useWorkspaceStore((s) => s.selectedPaneId);
  const setSelectedPane = useWorkspaceStore((s) => s.setSelectedPane);
  const appearance = useWorkspaceStore((s) => {
    const workspace = s.workspaces.find((candidate) => candidate.id === s.activeWorkspaceId);
    return workspace?.appearance ?? DEFAULT_WORKSPACE_APPEARANCE;
  });
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Drop zones show only while a page drag is hovering this pane. The native
  // dragenter/dragleave pair toggles this; the DropZones component handles
  // the actual drop and per-zone highlighting.
  const [dragOver, setDragOver] = React.useState(false);
  const terminalImmersive = usePageHostUiStore((s) => s.terminalMaximized)
    && focused
    && content?.pageId === "terminal";

  const active = selectedPaneId === paneId;
  const pickerVisible = !content || pickerOpen;
  const { blur, opacity } = normalizeWorkspaceAppearance(appearance);

  return (
    <div
      data-pane-id={paneId}
      data-pane-content={content ? "true" : "false"}
      data-widget-blur={blur}
      data-widget-opacity={opacity}
      className={`relative flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden ${
        terminalImmersive
          ? "rounded-none border-0"
          : "rounded-lg border border-[hsl(var(--sidebar-border))]/60"
      }`}
      onPointerDown={() => setSelectedPane(paneId)}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(PAGE_DRAG_MIME)) setDragOver(true);
      }}
      onDragOver={(e) => {
        // Allow the drop so dragenter/dragleave fire and the zones can read
        // the payload on drop.
        if (e.dataTransfer.types.includes(PAGE_DRAG_MIME)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the pane itself, not when crossing into a
        // child (the drop zones).
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        // DropZones handles the actual drop; this just prevents the page
        // underneath from receiving a navigation drop.
        e.preventDefault();
      }}
    >
      <div
        aria-hidden
        data-workspace-widget-surface
        className="pointer-events-none absolute inset-0"
        style={{
          // Match Terminal's glass behavior: only the surface tint receives
          // alpha. The page, text, icons, and controls remain fully opaque in
          // the composited layer above it.
          backgroundColor: `hsl(var(--background) / ${opacity / 100})`,
          ...(blur > 0 ? {
            backdropFilter: `blur(${blur}px)`,
            WebkitBackdropFilter: `blur(${blur}px)`,
          } : {}),
        }}
      />
      {!terminalImmersive && (
        <PaneHeader
          paneId={paneId}
          content={content}
          active={active}
          editMode={editMode}
          focused={focused}
          onAddPage={() => setPickerOpen(true)}
        />
      )}
      <div
        data-workspace-widget-content
        className={`relative z-1 flex-1 min-h-0 overflow-x-hidden bg-transparent ${
          terminalImmersive || pickerVisible ? "overflow-hidden" : "overflow-y-auto"
        }`}
        style={{ backgroundColor: "transparent" }}
      >
        {content ? (
          <PanePageHost
            paneId={paneId}
            content={content}
            visible={visible}
            requestFocus={() => useWorkspaceStore.getState().setFocus(focused ? null : paneId)}
            requestOpenFullPage={() => useWorkspaceStore.getState().setFocus(null)}
          />
        ) : null}
        {pickerVisible && (
          <PagePicker
            paneId={paneId}
            replacing={!!content}
            onClose={() => setPickerOpen(false)}
            onPlace={(pageId) => place(paneId, pageId)}
            inline={!content}
          />
        )}
        {dragOver && (
          <DropZones
            paneId={paneId}
            hasContent={!!content}
            onDropComplete={() => setDragOver(false)}
          />
        )}
      </div>
    </div>
  );
}
