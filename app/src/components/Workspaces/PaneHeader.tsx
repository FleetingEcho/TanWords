import React from "react";
import { Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import type { PageInstance } from "@/workspaces/model";
import { paneCount } from "@/workspaces/normalization";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { getPageDefinition } from "@/pages/pageCatalog";
import { Button } from "@/components/ui/button";
import { usePageDragSource } from "./DropZones";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

/** The pane header: a draggable page title plus replace, maximize, and close
 *  actions. Workspace-level split controls provide the non-drag layout path.
 *
 *  Maximize/restore appears only when the workspace has another pane to hide;
 *  for a single widget it cannot change the layout and is just dead chrome.
 *  Replacement appears in Edit mode; closing remains available during normal
 *  use but requires confirmation for a populated widget. Closing the only
 *  empty pane leaves the workspace because the layout must retain one pane. */
export interface PaneHeaderProps {
  paneId: string;
  content: PageInstance | null;
  active: boolean;
  editMode: boolean;
  focused: boolean;
  onAddPage: () => void;
}

export function PaneHeader({ paneId, content, active, editMode, focused, onAddPage }: PaneHeaderProps) {
  const t = useT();
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const closeWorkspace = useNavStore((s) => s.closeWorkspace);
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const setSelectedPane = useWorkspaceStore((s) => s.setSelectedPane);
  const hasMultiplePanes = useWorkspaceStore((s) => {
    const workspace = s.workspaces.find((candidate) => candidate.id === s.activeWorkspaceId);
    return !!workspace && paneCount(workspace.root) > 1;
  });

  const def = content ? getPageDefinition(content.pageId) : null;
  const Icon = def?.icon;
  const title = content ? t(`nav.${content.pageId}`) : t("workspaces.blank.title");
  const dragSource = usePageDragSource(content?.pageId ?? null, content ? paneId : undefined);

  return (
    <>
    <div
      className={`relative z-1 flex items-center gap-1 px-2 h-8 shrink-0 border-b text-xs select-none ${
        active || focused
          ? "border-primary/30 bg-primary/5 text-foreground"
          : "border-[hsl(var(--sidebar-border))] bg-[hsl(var(--muted))/40] text-muted-foreground"
      }`}
    >
      <span
        {...(content ? dragSource : {})}
        onPointerDown={() => setSelectedPane(paneId)}
        className={`flex items-center gap-1.5 flex-1 min-w-0 ${content ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate font-medium">{title}</span>
      </span>
      {content && editMode && (
        <>
          <HeaderButton title={t("workspaces.pane.replace")} onClick={onAddPage} icon={<RefreshCw className="h-3.5 w-3.5" />} />
        </>
      )}
      {content && hasMultiplePanes && (
        <HeaderButton
          title={t(focused ? "workspaces.pane.restore" : "workspaces.pane.maximize")}
          onClick={() => setFocus(focused ? null : paneId)}
          icon={focused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          active={focused}
        />
      )}
      <HeaderButton
        title={t(!content && !hasMultiplePanes ? "workspaces.close" : "workspaces.pane.close")}
        onClick={() => {
          if (content) setCloseConfirmOpen(true);
          else if (hasMultiplePanes) closePane(paneId);
          else closeWorkspace();
        }}
        icon={<X className="h-3.5 w-3.5" />}
      />
    </div>
    <ConfirmModal
      open={closeConfirmOpen}
      title={t("workspaces.pane.close")}
      message={t("workspaces.pane.closeConfirm")}
      confirmLabel={t("workspaces.pane.close")}
      onCancel={() => setCloseConfirmOpen(false)}
      onConfirm={() => {
        closePane(paneId);
        setCloseConfirmOpen(false);
      }}
    />
    </>
  );
}

function HeaderButton({ title, onClick, icon, active }: { title: string; onClick: () => void; icon: React.ReactNode; active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`h-6 w-6 ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
    >
      {icon}
    </Button>
  );
}
