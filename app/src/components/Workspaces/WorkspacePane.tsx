import React from "react";
import type { PageInstance } from "@/workspaces/model";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { PaneHeader } from "./PaneHeader";
import { PanePageHost } from "./PanePageHost";
import { PagePicker } from "./PagePicker";
import { DropZones, PAGE_DRAG_MIME } from "./DropZones";

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
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Drop zones show only while a page drag is hovering this pane. The native
  // dragenter/dragleave pair toggles this; the DropZones component handles
  // the actual drop and per-zone highlighting.
  const [dragOver, setDragOver] = React.useState(false);

  const active = selectedPaneId === paneId;
  const pickerVisible = !content || pickerOpen;

  return (
    <div
      data-pane-id={paneId}
      data-pane-content={content ? "true" : "false"}
      className="relative flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden rounded-lg border border-[hsl(var(--sidebar-border))]/60 bg-background"
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
      <PaneHeader
        paneId={paneId}
        content={content}
        active={active}
        editMode={editMode}
        focused={focused}
        onAddPage={() => setPickerOpen(true)}
      />
      <div className={`relative flex-1 min-h-0 overflow-x-hidden ${pickerVisible ? "overflow-hidden" : "overflow-y-auto"}`}>
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
